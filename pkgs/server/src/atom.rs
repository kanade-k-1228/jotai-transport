use crate::{BoxError, Value};

pub trait Atom: Send {
    fn value(&self) -> Option<Value>;

    fn commit(&mut self, value: Value);

    fn parse(&self, _raw: &Value) -> Option<Value> {
        None
    }

    fn load(&self) -> Option<Value> {
        None
    }

    fn persist(&self, _value: &Value) -> Result<(), BoxError> {
        Ok(())
    }
}
