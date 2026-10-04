#![allow(dead_code)]

use std::io::Write;
use std::path::Path;

pub fn fits(path: &Path, keywords: &[(&str, &str)]) -> std::io::Result<()> {
    let mut header = Vec::new();
    let mut card = |text: &str| {
        let mut bytes = [b' '; 80];
        let input = text.as_bytes();
        let n = input.len().min(80);
        bytes[..n].copy_from_slice(&input[..n]);
        header.extend_from_slice(&bytes);
    };
    for text in [
        "SIMPLE  =                    T",
        "BITPIX  =                   16",
        "NAXIS   =                    2",
        "NAXIS1  =                    4",
        "NAXIS2  =                    4",
        "BZERO   =                32768",
        "BSCALE  =                    1",
    ] {
        card(text);
    }
    for (key, value) in keywords {
        card(&format!("{key:<8}= {value}"));
    }
    card("END");
    header.resize(header.len().div_ceil(2880) * 2880, b' ');
    let mut file = std::fs::File::create(path)?;
    file.write_all(&header)?;
    let mut image = vec![0; 2880];
    for (index, sample) in image[..32].as_chunks_mut::<2>().0.iter_mut().enumerate() {
        let value = i16::try_from(index).expect("small fixture pixel");
        sample.copy_from_slice(&value.to_be_bytes());
    }
    file.write_all(&image)?;
    file.sync_all()
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn xisf(path: &Path, keywords: &[(&str, &str)]) -> std::io::Result<()> {
    use std::fmt::Write as _;
    let mut fields = String::new();
    for (key, value) in keywords {
        write!(
            fields,
            "<FITSKeyword name=\"{}\" value=\"{}\" comment=\"\"/>",
            xml_escape(key),
            xml_escape(value)
        )
        .expect("writing to a String cannot fail");
    }
    let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><xisf version=\"1.0\" xmlns=\"http://www.pixinsight.com/xisf\"><Image geometry=\"4:4:1\" sampleFormat=\"UInt16\" colorSpace=\"Gray\" location=\"attachment:4096:32\">{fields}</Image></xisf>");
    let mut bytes = b"XISF0100".to_vec();
    let length = u32::try_from(xml.len()).expect("small XML fixture");
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(&[0; 4]);
    bytes.extend_from_slice(xml.as_bytes());
    assert!(bytes.len() <= 4096, "fixture XML exceeds attachment offset");
    bytes.resize(4096, 0);
    for pixel in 0_u16..16 {
        bytes.extend_from_slice(&pixel.to_le_bytes());
    }
    let mut file = std::fs::File::create(path)?;
    file.write_all(&bytes)?;
    file.sync_all()
}

pub fn digest(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(std::fs::read(path).expect("fixture readable")))
}
