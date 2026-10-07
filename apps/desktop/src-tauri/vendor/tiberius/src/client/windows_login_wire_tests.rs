#![deny(clippy::all)]
use super::*;
use crate::client::windows_login::Step;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

struct Wire {
    input: futures_util::io::Cursor<Vec<u8>>,
    output: Arc<Mutex<Vec<u8>>>,
}
impl AsyncRead for Wire {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut task::Context<'_>,
        buf: &mut [u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.input).poll_read(cx, buf)
    }
}
impl AsyncWrite for Wire {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut task::Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.output.lock().unwrap().extend_from_slice(buf);
        Poll::Ready(Ok(buf.len()))
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut task::Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_close(self: Pin<&mut Self>, _: &mut task::Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

struct Script(VecDeque<(Option<Vec<u8>>, Step)>);
impl Negotiator for Script {
    fn step(&mut self, input: Option<&[u8]>) -> crate::Result<Step> {
        let (expected, output) = self.0.pop_front().expect("extra authentication call");
        assert_eq!(input, expected.as_deref());
        Ok(output)
    }
}
type ScriptStep<'a> = (Option<&'a [u8]>, &'a [u8], bool);
fn login(steps: &[ScriptStep<'_>]) -> WindowsLogin<Script> {
    WindowsLogin::new(Script(
        steps
            .iter()
            .map(|(input, output, complete)| {
                (
                    input.map(<[u8]>::to_vec),
                    Step {
                        token: output.to_vec(),
                        complete: *complete,
                    },
                )
            })
            .collect(),
    ))
}
fn packet(body: &[u8]) -> Vec<u8> {
    let size = (body.len() + 8) as u16;
    let mut bytes = vec![4, 1, (size >> 8) as u8, size as u8, 0, 0, 1, 0];
    bytes.extend_from_slice(body);
    bytes
}
fn sspi(value: &[u8]) -> Vec<u8> {
    let mut body = vec![0xed];
    body.extend_from_slice(&(value.len() as u16).to_le_bytes());
    body.extend_from_slice(value);
    body
}
fn ack() -> Vec<u8> {
    // LOGINACK, 10-byte body: TSQL, TDS 7.4, empty product name, version.
    vec![0xad, 10, 0, 1, 0x74, 0, 0, 4, 0, 0, 0, 0, 0]
}
fn done() -> Vec<u8> {
    vec![0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}
fn connection(packets: Vec<u8>) -> (Connection<Wire>, Arc<Mutex<Vec<u8>>>) {
    let output = Arc::new(Mutex::new(Vec::new()));
    let wire = Wire {
        input: futures_util::io::Cursor::new(packets),
        output: output.clone(),
    };
    (
        Connection {
            transport: Framed::new(MaybeTlsStream::Raw(wire), PacketCodec),
            flushed: false,
            context: Context::new(),
            buf: BytesMut::new(),
        },
        output,
    )
}

#[tokio::test]
async fn kerberos_final_sspi_ack_and_done_in_same_packet_do_not_hang_or_send_empty_message() {
    let (mut conn, output) = connection(packet(&[sspi(b"AP-REP"), ack(), done()].concat()));
    let mut login = login(&[(None, b"AP-REQ", false), (Some(b"AP-REP"), b"", true)]);
    login.next(None).unwrap();
    conn.finish_windows_login(login).await.unwrap();
    assert!(output.lock().unwrap().is_empty());
    assert!(conn.is_eof());
}

#[tokio::test]
async fn continuation_uses_sspi_packet_type_not_login7_and_handles_multiple_rounds() {
    let packets = [
        packet(&sspi(b"one")),
        packet(&sspi(b"two")),
        packet(&[ack(), done()].concat()),
    ]
    .concat();
    let (mut conn, output) = connection(packets);
    let mut login = login(&[
        (None, b"initial", false),
        (Some(b"one"), b"response1", false),
        (Some(b"two"), b"response2", true),
    ]);
    login.next(None).unwrap();
    conn.finish_windows_login(login).await.unwrap();
    let bytes = output.lock().unwrap();
    assert_eq!(&bytes[..2], &[0x11, 1]);
    assert_eq!(&bytes[8..17], b"response1");
    assert_eq!(&bytes[17..19], &[0x11, 1]);
    assert_eq!(&bytes[25..], b"response2");
}

#[tokio::test]
async fn refuses_login_ack_before_security_context_completion_and_missing_ack() {
    for (complete, response) in [(false, [ack(), done()].concat()), (true, done())] {
        let (mut conn, _) = connection(packet(&response));
        let mut login = login(&[(None, b"initial", complete)]);
        login.next(None).unwrap();
        assert!(conn.finish_windows_login(login).await.is_err());
    }
}

#[tokio::test]
async fn handles_immediate_completion_and_rejects_server_error_done() {
    let (mut conn, _) = connection(packet(&[ack(), done()].concat()));
    let mut auth = login(&[(None, b"initial", true)]);
    auth.next(None).unwrap();
    conn.finish_windows_login(auth).await.unwrap();
    let mut failed = done();
    failed[1] = 2; // DONE_ERROR, even if no preceding ERROR token was supplied.
    let (mut conn, _) = connection(packet(&[ack(), failed].concat()));
    let mut auth = login(&[(None, b"initial", true)]);
    auth.next(None).unwrap();
    assert!(conn.finish_windows_login(auth).await.is_err());
}

#[tokio::test]
async fn missing_done_and_malformed_sspi_fail_without_exposing_buffers() {
    for response in [ack(), vec![0xed, 20, 0, 1]] {
        let (mut conn, _) = connection(packet(&response));
        let mut auth = login(&[(None, b"initial", true)]);
        auth.next(None).unwrap();
        assert!(conn.finish_windows_login(auth).await.is_err());
    }
    let token = codec::TokenSspi::new(b"private-auth-token".to_vec());
    assert!(!format!("{token:?}").contains("private-auth-token"));
    assert_eq!(format!("{token:?}"), "TokenSspi { bytes: 18, .. }");
    let mut login = LoginMessage::new();
    login.password("private-password");
    assert_eq!(format!("{login:?}"), "LoginMessage { .. }");
}

#[tokio::test]
async fn server_domain_rejection_is_preserved_without_another_authentication_attempt() {
    let message: Vec<_> = "Login failed: untrusted domain".encode_utf16().collect();
    let mut body = Vec::new();
    body.extend_from_slice(&18452u32.to_le_bytes());
    body.extend_from_slice(&[1, 14]); // State and severity.
    body.extend_from_slice(&(message.len() as u16).to_le_bytes());
    for ch in message {
        body.extend_from_slice(&ch.to_le_bytes());
    }
    body.extend_from_slice(&[0, 0]); // Server/procedure names.
    body.extend_from_slice(&1u32.to_le_bytes());
    let mut error = vec![0xaa];
    error.extend_from_slice(&(body.len() as u16).to_le_bytes());
    error.extend(body);
    let (mut conn, output) = connection(packet(&[error, done()].concat()));
    let mut login = login(&[(None, b"initial", false)]);
    login.next(None).unwrap();
    assert_eq!(
        conn.finish_windows_login(login).await.unwrap_err().code(),
        Some(18452)
    );
    assert!(output.lock().unwrap().is_empty());
}
