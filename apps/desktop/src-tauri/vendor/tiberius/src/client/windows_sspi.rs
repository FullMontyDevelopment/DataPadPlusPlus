//! Current-account Windows Negotiate. No password, explicit NTLM downgrade,
//! interactive sign-in, or application-owned credential cache.
#![deny(clippy::all)]
use super::windows_login::{protocol_error, Negotiator, Step};
use std::{ffi::c_void, ptr};
use windows_sys::Win32::{
    Foundation::{
        SEC_E_OK, SEC_I_COMPLETE_AND_CONTINUE, SEC_I_COMPLETE_NEEDED, SEC_I_CONTINUE_NEEDED,
    },
    Security::{Authentication::Identity::*, Credentials::SecHandle},
};
use zeroize::{Zeroize, Zeroizing};

const NEGOTIATE: &[u16] = &[78, 101, 103, 111, 116, 105, 97, 116, 101, 0];
const INVALID: SecHandle = SecHandle {
    dwLower: usize::MAX,
    dwUpper: usize::MAX,
};

fn valid(handle: &SecHandle) -> bool {
    handle.dwLower != usize::MAX || handle.dwUpper != usize::MAX
}

fn error(operation: &'static str, status: i32) -> crate::Error {
    // Do not include SPNs, account names, or opaque SSPI buffers.
    crate::Error::Protocol(
        format!(
            "Windows SSPI negotiation: {operation} failed (0x{:08X})",
            status as u32
        )
        .into(),
    )
}

pub(super) struct WindowsSspi {
    credentials: SecHandle,
    context: SecHandle,
    target: Vec<u16>,
    // u32 storage keeps SEC_CHANNEL_BINDINGS aligned for Windows.
    bindings: Vec<u32>,
}

impl WindowsSspi {
    pub fn new(spn: &str, tls_endpoint: Option<&[u8]>) -> crate::Result<Self> {
        if spn.is_empty() || spn.contains('\0') {
            return Err(protocol_error("invalid SQL Server service principal"));
        }
        let mut auth = Self {
            credentials: INVALID,
            context: INVALID,
            target: service_principal(spn, resolve_short_name)?
                .encode_utf16()
                .chain(Some(0))
                .collect(),
            bindings: channel_bindings(tls_endpoint)?,
        };
        let mut expiry = 0;
        // SAFETY: all output pointers are valid. Null principal/auth data selects
        // the calling process account; Windows owns the returned credential handle.
        let status = unsafe {
            AcquireCredentialsHandleW(
                ptr::null(),
                NEGOTIATE.as_ptr(),
                SECPKG_CRED_OUTBOUND,
                ptr::null(),
                ptr::null(),
                None,
                ptr::null(),
                &mut auth.credentials,
                &mut expiry,
            )
        };
        if status != SEC_E_OK {
            return Err(error("acquiring current-account credentials", status));
        }
        Ok(auth)
    }
}

fn service_principal(
    spn: &str,
    resolve: impl FnOnce(&str) -> crate::Result<String>,
) -> crate::Result<String> {
    let (host, port) = spn
        .strip_prefix("MSSQLSvc/")
        .and_then(|value| value.rsplit_once(':'))
        .ok_or_else(|| protocol_error("invalid SQL Server service principal"))?;
    if port.parse::<u16>().ok().filter(|port| *port != 0).is_none() || host.is_empty() {
        return Err(protocol_error("invalid SQL Server service principal"));
    }
    // Preserve explicit FQDNs/aliases. AI_FQDN expands a flat DNS name using the
    // Windows resolver's actual suffix, without guessing a domain or following
    // a CNAME away from an explicitly configured alias. IP literals are not
    // reverse-resolved into an assumed Kerberos identity.
    let host = host.trim_end_matches('.');
    let resolved =
        if !host.contains('.') && !host.contains(':') && !host.eq_ignore_ascii_case("localhost") {
            resolve(host)?
        } else {
            host.to_owned()
        };
    Ok(format!(
        "MSSQLSvc/{}:{port}",
        resolved.trim_end_matches('.')
    ))
}

fn resolve_short_name(host: &str) -> crate::Result<String> {
    use windows_sys::Win32::Networking::WinSock::{
        FreeAddrInfoW, GetAddrInfoW, ADDRINFOW, AI_FQDN, SOCK_STREAM,
    };
    let name: Vec<_> = host.encode_utf16().chain(Some(0)).collect();
    let hints = ADDRINFOW {
        ai_flags: AI_FQDN as i32,
        ai_socktype: SOCK_STREAM,
        ..Default::default()
    };
    let mut result = ptr::null_mut();
    // SAFETY: Winsock is initialized by the established TCP transport. Input is
    // null-terminated; result belongs to Windows and is freed below on all paths.
    let status = unsafe { GetAddrInfoW(name.as_ptr(), ptr::null(), &hints, &mut result) };
    if status != 0 {
        return Err(error("resolving the SQL Server DNS service name", status));
    }
    struct Addresses(*mut ADDRINFOW);
    impl Drop for Addresses {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    FreeAddrInfoW(self.0);
                }
            }
        }
    }
    let addresses = Addresses(result);
    if addresses.0.is_null() {
        return Err(protocol_error("SQL Server DNS service name is unavailable"));
    }
    // SAFETY: successful GetAddrInfoW returns an ADDRINFOW linked list with
    // null-terminated canonical names. Bound the string scan to a DNS-sized name.
    let canonical = unsafe { (*addresses.0).ai_canonname };
    if canonical.is_null() {
        return Ok(host.to_owned());
    }
    let mut length = 0;
    while length < 256 && unsafe { *canonical.add(length) } != 0 {
        length += 1;
    }
    if length == 0 || length == 256 {
        return Err(protocol_error("invalid resolved SQL Server DNS name"));
    }
    String::from_utf16(unsafe { std::slice::from_raw_parts(canonical, length) })
        .map_err(|_| protocol_error("invalid resolved SQL Server DNS name"))
}

/// RFC 5929 application data inside the Windows SEC_CHANNEL_BINDINGS structure.
fn channel_bindings(endpoint: Option<&[u8]>) -> crate::Result<Vec<u32>> {
    let Some(endpoint) = endpoint else {
        return Ok(Vec::new());
    };
    if endpoint.is_empty() || endpoint.len() > 128 {
        return Err(protocol_error("invalid TLS channel binding"));
    }
    let data = [b"tls-server-end-point:".as_slice(), endpoint].concat();
    let mut words = vec![0u32; 8 + data.len().div_ceil(4)];
    words[6] = data.len() as u32;
    words[7] = 32;
    for (word, chunk) in words[8..].iter_mut().zip(data.chunks(4)) {
        let mut bytes = [0; 4];
        bytes[..chunk.len()].copy_from_slice(chunk);
        *word = u32::from_ne_bytes(bytes);
    }
    Ok(words)
}

struct Output(SecBuffer);
impl Drop for Output {
    fn drop(&mut self) {
        if !self.0.pvBuffer.is_null() {
            // SAFETY: ISC_REQ_ALLOCATE_MEMORY transfers an SSPI-owned allocation.
            unsafe {
                std::slice::from_raw_parts_mut(
                    self.0.pvBuffer.cast::<u8>(),
                    self.0.cbBuffer as usize,
                )
                .zeroize();
                FreeContextBuffer(self.0.pvBuffer);
            }
        }
    }
}

impl Negotiator for WindowsSspi {
    fn step(&mut self, incoming: Option<&[u8]>) -> crate::Result<Step> {
        let mut token = Zeroizing::new(incoming.unwrap_or_default().to_vec());
        let mut inputs = Vec::with_capacity(2);
        if incoming.is_some() {
            inputs.push(SecBuffer {
                BufferType: SECBUFFER_TOKEN,
                cbBuffer: token.len() as u32,
                pvBuffer: token.as_mut_ptr().cast(),
            });
        }
        if !self.bindings.is_empty() {
            inputs.push(SecBuffer {
                BufferType: SECBUFFER_CHANNEL_BINDINGS,
                cbBuffer: (self.bindings.len() * 4) as u32,
                pvBuffer: self.bindings.as_mut_ptr().cast(),
            });
        }
        let input = SecBufferDesc {
            ulVersion: SECBUFFER_VERSION,
            cBuffers: inputs.len() as u32,
            pBuffers: inputs.as_mut_ptr(),
        };
        let mut output = Output(SecBuffer {
            BufferType: SECBUFFER_TOKEN,
            cbBuffer: 0,
            pvBuffer: ptr::null_mut::<c_void>(),
        });
        let mut output_desc = SecBufferDesc {
            ulVersion: SECBUFFER_VERSION,
            cBuffers: 1,
            pBuffers: &mut output.0,
        };
        let mut attributes = 0;
        let mut expiry = 0;
        let current_context = self.context;
        let previous = if valid(&current_context) {
            &current_context as *const _
        } else {
            ptr::null()
        };
        // SAFETY: the buffers and descriptors remain alive for this synchronous
        // call. Only this instance uses these handles, sequentially. The existing
        // handle value is copied so input/output pointers never alias in Rust.
        let status = unsafe {
            InitializeSecurityContextW(
                &self.credentials,
                previous,
                self.target.as_ptr(),
                ISC_REQ_ALLOCATE_MEMORY
                    | ISC_REQ_CONNECTION
                    | ISC_REQ_MUTUAL_AUTH
                    | ISC_REQ_REPLAY_DETECT
                    | ISC_REQ_SEQUENCE_DETECT
                    | ISC_REQ_CONFIDENTIALITY,
                0,
                SECURITY_NATIVE_DREP,
                if inputs.is_empty() {
                    ptr::null()
                } else {
                    &input
                },
                0,
                &mut self.context,
                &mut output_desc,
                &mut attributes,
                &mut expiry,
            )
        };
        let complete = match status {
            SEC_E_OK | SEC_I_COMPLETE_NEEDED => true,
            SEC_I_CONTINUE_NEEDED | SEC_I_COMPLETE_AND_CONTINUE => false,
            _ => return Err(error("establishing the security context", status)),
        };
        if matches!(status, SEC_I_COMPLETE_NEEDED | SEC_I_COMPLETE_AND_CONTINUE) {
            // SAFETY: valid context and the output descriptor from the call above.
            let status = unsafe { CompleteAuthToken(&self.context, &output_desc) };
            if status != SEC_E_OK {
                return Err(error("completing the security token", status));
            }
        }
        if output.0.cbBuffer > u16::MAX as u32
            || (output.0.cbBuffer != 0 && output.0.pvBuffer.is_null())
        {
            return Err(protocol_error("invalid authentication output buffer"));
        }
        let token = if output.0.cbBuffer == 0 {
            Vec::new()
        } else {
            // SAFETY: SSPI supplied a non-null allocation of cbBuffer bytes.
            unsafe {
                std::slice::from_raw_parts(
                    output.0.pvBuffer.cast::<u8>(),
                    output.0.cbBuffer as usize,
                )
            }
            .to_vec()
        };
        Ok(Step { token, complete })
    }
}

impl Drop for WindowsSspi {
    fn drop(&mut self) {
        // SAFETY: each successful/partially established handle is released once,
        // with the context released before its credentials (including on errors).
        unsafe {
            if valid(&self.context) {
                DeleteSecurityContext(&self.context);
            }
            if valid(&self.credentials) {
                FreeCredentialsHandle(&self.credentials);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_negotiate_and_current_process_credentials_without_network_io() {
        assert_eq!(
            String::from_utf16(&NEGOTIATE[..NEGOTIATE.len() - 1]).unwrap(),
            "Negotiate"
        );
        let auth = WindowsSspi::new("MSSQLSvc/localhost:1433", None).unwrap();
        assert!(valid(&auth.credentials));
        assert!(!valid(&auth.context));
    }
    #[test]
    fn endpoint_binding_has_correct_offsets_lengths_and_prefix() {
        let words = channel_bindings(Some(&[0xab; 32])).unwrap();
        assert_eq!(&words[..6], &[0; 6]);
        assert_eq!(words[6], 53);
        assert_eq!(words[7], 32);
        let bytes: Vec<_> = words[8..]
            .iter()
            .flat_map(|word| word.to_ne_bytes())
            .collect();
        assert_eq!(&bytes[..21], b"tls-server-end-point:");
        assert_eq!(&bytes[21..53], &[0xab; 32]);
        assert!(channel_bindings(None).unwrap().is_empty());
        assert!(channel_bindings(Some(&[])).is_err());
    }
    #[test]
    fn errors_do_not_dump_tokens_or_principals() {
        assert!(WindowsSspi::new("MSSQLSvc/private\0host:1433", None).is_err());
        let error = error("establishing the security context", 0x8009030c_u32 as i32).to_string();
        assert!(error.contains("0x8009030C"));
        assert!(!error.contains("private"));
    }
    #[test]
    fn service_principal_expands_short_names_and_preserves_actual_port() {
        assert_eq!(
            service_principal("MSSQLSvc/db01:51433", |name| {
                assert_eq!(name, "db01");
                Ok("db01.corp.example".into())
            })
            .unwrap(),
            "MSSQLSvc/db01.corp.example:51433"
        );
        for name in ["alias.corp.example", "127.0.0.1", "::1", "localhost"] {
            let spn = format!("MSSQLSvc/{name}:1433");
            assert_eq!(
                service_principal(&spn, |_| panic!("must not rewrite explicit identities"))
                    .unwrap(),
                spn
            );
        }
        assert_eq!(
            service_principal("MSSQLSvc/alias.corp.example.:1433", |_| unreachable!()).unwrap(),
            "MSSQLSvc/alias.corp.example:1433"
        );
        assert!(service_principal("MSSQLSvc/db01:0", |_| unreachable!()).is_err());
        assert!(
            service_principal("MSSQLSvc/db01:1433", |_| Err(protocol_error("DNS failed"))).is_err()
        );
    }
}
