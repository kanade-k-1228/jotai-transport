use rppal::gpio::{Gpio, OutputPin};
use serde_json::Value;
use transport_server::Atom;

pub(crate) struct LedAtom {
    name: &'static str,
    value: bool,
    pin: Option<OutputPin>,
    inverse: bool,
}

impl LedAtom {
    pub(crate) fn new(name: &'static str, gpio: Option<&Gpio>, pin_num: u8, inverse: bool) -> Self {
        let pin = gpio.and_then(|g| match g.get(pin_num) {
            Ok(pin) => {
                println!("[gpio] {name} -> BCM {pin_num}");
                Some(pin.into_output())
            }
            Err(e) => {
                eprintln!("[gpio] {name}: cannot open BCM {pin_num} ({e})");
                None
            }
        });
        let mut atom = LedAtom {
            name,
            value: false,
            pin,
            inverse,
        };
        atom.write(false); // ensure the LED starts off
        atom
    }

    fn write(&mut self, on: bool) {
        self.value = on;
        let inverse = self.inverse;
        match &mut self.pin {
            Some(pin) => {
                if on != inverse {
                    pin.set_high();
                } else {
                    pin.set_low();
                }
            }
            None => println!("[mock] {} = {}", self.name, if on { "ON" } else { "OFF" }),
        }
    }
}

impl Atom for LedAtom {
    fn get(&self) -> Value {
        Value::Bool(self.value)
    }

    fn set(&mut self, value: Value) {
        if let Value::Bool(on) = value {
            self.write(on);
        }
    }
}
