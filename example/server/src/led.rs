use rppal::gpio::{Gpio, OutputPin};
use serde_json::Value;
use transport_server::Atom;

pub struct LedAtom {
    value: bool,
    pin: Option<OutputPin>,
}

impl LedAtom {
    pub fn new(gpio: Option<&Gpio>, pin_num: u8) -> Self {
        let pin = gpio
            .and_then(|g| g.get(pin_num).ok())
            .map(|pin| pin.into_output());
        let mut atom = Self { value: false, pin };
        atom.write(false); // ensure the LED starts off
        atom
    }

    fn write(&mut self, value: bool) {
        self.value = value;
        if let Some(pin) = &mut self.pin {
            match value {
                true => pin.set_high(),
                false => pin.set_low(),
            }
        }
    }
}

impl Atom for LedAtom {
    fn get(&self) -> Value {
        Value::Bool(self.value)
    }

    fn set(&mut self, value: Value) {
        if let Value::Bool(v) = value {
            self.write(v);
        }
    }
}
