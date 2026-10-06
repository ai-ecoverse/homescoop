use clap::Parser;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Point {
    x: i32,
    label: String,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("bad point {0}")]
    Bad(i32),
}

#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 7)]
    x: i32,
}

fn main() {
    let args = Args::parse();
    let point = Point { x: args.x, label: "slicc".into() };
    let json = serde_json::to_string(&point).unwrap();
    let back: Point = serde_json::from_str(&json).unwrap();
    assert_eq!(back, point);
    println!("{json} {}", AppError::Bad(back.x));
}
