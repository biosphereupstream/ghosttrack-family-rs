pub mod geo;
pub mod osint;
pub mod phone;
pub mod security;

use serde::Deserialize;
use std::slice;
use std::sync::atomic::{AtomicUsize, Ordering};

static LAST_LEN: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        let _ = Vec::from_raw_parts(ptr, len, len);
    }
}

#[no_mangle]
pub extern "C" fn wasm_last_len() -> usize {
    LAST_LEN.load(Ordering::SeqCst)
}

fn write_output(bytes: Vec<u8>) -> *mut u8 {
    let len = bytes.len();
    LAST_LEN.store(len, Ordering::SeqCst);
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    ptr
}

unsafe fn read_utf8<'a>(ptr: *const u8, len: usize) -> &'a str {
    if ptr.is_null() || len == 0 {
        return "";
    }
    let slice = slice::from_raw_parts(ptr, len);
    std::str::from_utf8(slice).unwrap_or("")
}

#[no_mangle]
pub unsafe extern "C" fn wasm_parse_phone(ptr: *const u8, len: usize) -> *mut u8 {
    let raw = read_utf8(ptr, len);
    let info = phone::parse_phone(raw, Some("ID"));
    let json = serde_json::to_vec(&info).unwrap_or_else(|_| b"{}".to_vec());
    write_output(json)
}

#[no_mangle]
pub extern "C" fn wasm_haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    geo::haversine_m(lat1, lng1, lat2, lng2)
}

#[derive(Deserialize)]
struct PinHashRequest {
    group_code: String,
    pin: String,
}

#[no_mangle]
pub unsafe extern "C" fn wasm_hash_pin(ptr: *const u8, len: usize) -> *mut u8 {
    let raw = read_utf8(ptr, len);
    let json = match serde_json::from_str::<PinHashRequest>(raw) {
        Ok(req) => {
            let normalized_code = security::normalize_group_code(&req.group_code);
            let hash = security::hash_family_pin(&normalized_code, &req.pin);
            serde_json::to_vec(&serde_json::json!({
                "normalized_code": normalized_code,
                "hash": hash
            }))
            .unwrap_or_else(|_| b"{}".to_vec())
        }
        Err(_) => b"{\"error\":\"invalid payload\"}".to_vec(),
    };
    write_output(json)
}

#[derive(Deserialize)]
struct GeofenceRequest {
    lat: f64,
    lng: f64,
    zones: Vec<geo::SafeZoneInput>,
}

#[no_mangle]
pub unsafe extern "C" fn wasm_check_geofence(ptr: *const u8, len: usize) -> *mut u8 {
    let raw = read_utf8(ptr, len);
    let json = match serde_json::from_str::<GeofenceRequest>(raw) {
        Ok(req) => {
            let checks = geo::evaluate_geofences(req.lat, req.lng, &req.zones);
            serde_json::to_vec(&checks).unwrap_or_else(|_| b"[]".to_vec())
        }
        Err(_) => b"[]".to_vec(),
    };
    write_output(json)
}

#[no_mangle]
pub unsafe extern "C" fn wasm_osint_platforms(ptr: *const u8, len: usize) -> *mut u8 {
    let username = read_utf8(ptr, len);
    let targets = osint::build_osint_targets(username);
    let json = serde_json::to_vec(&targets).unwrap_or_else(|_| b"[]".to_vec());
    write_output(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indonesian_carriers_and_e164() {
        let tsel = phone::parse_phone("0812-3456-7890", Some("ID"));
        assert!(tsel.valid);
        assert_eq!(tsel.e164, "+6281234567890");
        assert!(tsel.carrier.contains("Telkomsel"));

        let isat = phone::parse_phone("+62 815 9988 7766", Some("ID"));
        assert!(isat.valid);
        assert!(isat.carrier.contains("Indosat"));

        let xl = phone::parse_phone("08171234567", Some("ID"));
        assert!(xl.valid);
        assert!(xl.carrier.contains("XL Axiata"));

        let tri = phone::parse_phone("089612345678", Some("ID"));
        assert!(tri.valid);
        assert!(tri.carrier.contains("Tri"));

        let sf = phone::parse_phone("08811234567", Some("ID"));
        assert!(sf.valid);
        assert!(sf.carrier.contains("Smartfren"));

        let byu = phone::parse_phone("085154123456", Some("ID"));
        assert!(byu.valid);
        assert!(byu.carrier.contains("By.U"));
    }

    #[test]
    fn test_international_phone_parsing() {
        let sg = phone::parse_phone("+6591234567", Some("ID"));
        assert!(sg.valid);
        assert_eq!(sg.iso_code, "SG");
        assert_eq!(sg.country, "Singapura");

        let us = phone::parse_phone("+1 415 555 0199", Some("ID"));
        assert!(us.valid);
        assert_eq!(us.iso_code, "US");
    }

    #[test]
    fn test_haversine_and_geofence() {
        // Monas to Bundaran HI (~2.2-2.3 km)
        let dist = geo::haversine_m(-6.175392, 106.827153, -6.194957, 106.823045);
        assert!(dist > 2000.0 && dist < 2500.0, "dist was {}", dist);

        let zones = vec![
            geo::SafeZoneInput {
                id: Some("home".to_string()),
                name: "Rumah".to_string(),
                lat: -6.175392,
                lng: 106.827153,
                radius_m: 150.0,
            },
            geo::SafeZoneInput {
                id: Some("office".to_string()),
                name: "Kantor".to_string(),
                lat: -6.194957,
                lng: 106.823045,
                radius_m: 150.0,
            },
        ];

        let checks = geo::evaluate_geofences(-6.1754, 106.8272, &zones);
        assert!(checks[0].inside);
        assert!(!checks[1].inside);
    }

    #[test]
    fn test_sha256_and_pin_hashing() {
        assert_eq!(
            security::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let h1 = security::hash_family_pin("kel-777", "1234");
        let h2 = security::hash_family_pin("KEL-777", "1234");
        assert_eq!(h1, h2);
        assert_ne!(h1, security::hash_family_pin("KEL-777", "9999"));
    }

    #[test]
    fn test_osint_platforms_matrix() {
        let targets = osint::build_osint_targets("@anindya_dev");
        assert_eq!(targets.len(), 22);
        assert_eq!(targets[0].site, "GitHub");
        assert_eq!(targets[0].url, "https://www.github.com/anindya_dev");
    }
}
