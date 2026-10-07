//! Bounded Windows SSPI exchange, independent of the selected Windows provider.
//! Never log authentication buffers, including on protocol failure.
#![deny(clippy::all)]

pub(super) struct Step {
    pub token: Vec<u8>,
    pub complete: bool,
}

pub(super) trait Negotiator: Send {
    fn step(&mut self, incoming: Option<&[u8]>) -> crate::Result<Step>;
}

pub(super) struct WindowsLogin<A> {
    auth: A,
    complete: bool,
    rounds: usize,
    acknowledged: bool,
}

pub(super) fn protocol_error(message: &'static str) -> crate::Error {
    crate::Error::Protocol(format!("Windows SSPI negotiation: {message}").into())
}

impl<A: Negotiator> WindowsLogin<A> {
    pub fn new(auth: A) -> Self {
        Self {
            auth,
            complete: false,
            rounds: 0,
            acknowledged: false,
        }
    }

    pub fn next(&mut self, incoming: Option<&[u8]>) -> crate::Result<Vec<u8>> {
        if self.complete || self.rounds >= 16 {
            return Err(protocol_error(
                "unexpected or excessive authentication challenge",
            ));
        }
        if (self.rounds == 0) != incoming.is_none() || incoming.is_some_and(|v| v.is_empty()) {
            return Err(protocol_error("missing authentication challenge"));
        }
        let step = self.auth.step(incoming)?;
        if step.token.len() > u16::MAX as usize {
            return Err(protocol_error(
                "authentication token exceeds the TDS login limit",
            ));
        }
        if step.token.is_empty() && (!step.complete || self.rounds == 0) {
            return Err(protocol_error(
                "authentication did not produce a required token",
            ));
        }
        self.complete = step.complete;
        self.rounds += 1;
        Ok(step.token)
    }

    pub fn acknowledge(&mut self) -> crate::Result<()> {
        if !self.complete || self.acknowledged {
            return Err(protocol_error(
                "server acknowledged an incomplete authentication exchange",
            ));
        }
        self.acknowledged = true;
        Ok(())
    }

    pub fn finish(&self) -> crate::Result<()> {
        if !self.complete || !self.acknowledged {
            return Err(protocol_error(
                "server did not complete and acknowledge authentication",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct Script(VecDeque<Step>);
    impl Negotiator for Script {
        fn step(&mut self, _: Option<&[u8]>) -> crate::Result<Step> {
            Ok(self.0.pop_front().expect("unexpected SSPI call"))
        }
    }
    fn login(steps: &[(bool, usize)]) -> WindowsLogin<Script> {
        WindowsLogin::new(Script(
            steps
                .iter()
                .map(|(complete, size)| Step {
                    token: vec![42; *size],
                    complete: *complete,
                })
                .collect(),
        ))
    }

    #[test]
    fn kerberos_final_server_token_can_complete_without_client_output() {
        let mut login = login(&[(false, 8), (true, 0)]);
        assert_eq!(login.next(None).unwrap().len(), 8);
        assert!(login.next(Some(b"AP-REP")).unwrap().is_empty());
        login.acknowledge().unwrap();
        login.finish().unwrap();
    }
    #[test]
    fn negotiated_ntlm_completion_still_sends_the_final_client_token() {
        let mut login = login(&[(false, 8), (true, 12)]);
        login.next(None).unwrap();
        assert_eq!(login.next(Some(b"challenge")).unwrap().len(), 12);
        login.acknowledge().unwrap();
        login.finish().unwrap();
    }
    #[test]
    fn supports_multi_round_spnego_not_only_two_ntlm_messages() {
        let mut login = login(&[(false, 8), (false, 8), (false, 8), (true, 0)]);
        login.next(None).unwrap();
        for _ in 0..3 {
            login.next(Some(b"challenge")).unwrap();
        }
        login.acknowledge().unwrap();
        login.finish().unwrap();
    }
    #[test]
    fn requires_both_sspi_completion_and_server_acknowledgement() {
        let mut pending = login(&[(false, 8)]);
        pending.next(None).unwrap();
        assert!(pending.acknowledge().is_err());
        assert!(pending.finish().is_err());
        let mut complete = login(&[(true, 8)]);
        complete.next(None).unwrap();
        assert!(complete.finish().is_err());
        complete.acknowledge().unwrap();
        assert!(complete.acknowledge().is_err());
        assert!(complete.next(Some(b"extra")).is_err());
    }
    #[test]
    fn rejects_empty_required_tokens_and_overlong_tokens() {
        assert!(login(&[(false, 0)]).next(None).is_err());
        assert!(login(&[(true, 0)]).next(None).is_err());
        assert!(login(&[(false, 65_536)]).next(None).is_err());
    }
    #[test]
    fn bounds_rounds_and_rejects_missing_challenges() {
        let mut login = login(&[(false, 1); 16]);
        assert!(login.next(Some(b"unexpected")).is_err());
        login.next(None).unwrap();
        assert!(login.next(None).is_err());
        assert!(login.next(Some(b"")).is_err());
        for _ in 1..16 {
            login.next(Some(b"challenge")).unwrap();
        }
        assert!(login.next(Some(b"challenge")).is_err());
    }
}
