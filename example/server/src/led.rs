use std::cell::RefCell;

use rppal::gpio::{Gpio, OutputPin};
use transport_server::{Atom, BoxError, Value};

pub struct LedAtom {
    value: Option<bool>,
    pin: Option<RefCell<OutputPin>>,
}

impl LedAtom {
    pub fn new(gpio: Option<&Gpio>, pin_num: u8) -> Self {
        let pin = gpio
            .and_then(|g| g.get(pin_num).ok())
            .map(|pin| RefCell::new(pin.into_output()));
        let mut atom = Self { value: None, pin };
        atom.commit(Value::Bool(false)); // ensure the LED starts off
        if let Err(e) = atom.persist(&Value::Bool(false)) {
            eprintln!("[led] init persist failed: {e}");
        }
        atom
    }
}

impl Atom for LedAtom {
    fn value(&self) -> Option<Value> {
        self.value.map(Value::Bool)
    }

    fn commit(&mut self, value: Value) {
        if let Value::Bool(v) = value {
            self.value = Some(v);
        }
    }

    fn parse(&self, raw: &Value) -> Option<Value> {
        raw.as_bool().map(Value::Bool)
    }

    fn persist(&self, value: &Value) -> Result<(), BoxError> {
        let Some(on) = value.as_bool() else {
            return Ok(());
        };
        if let Some(pin) = &self.pin {
            match on {
                true => pin.borrow_mut().set_high(),
                false => pin.borrow_mut().set_low(),
            }
        }
        Ok(())
    }
}
