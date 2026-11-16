use ghosttrack_core::{
    geo::haversine_m,
    osint::{build_osint_targets, OsintPlatformTarget},
    phone::{parse_phone, PhoneInfo},
};

#[tauri::command]
fn analyze_phone_native(number: String) -> PhoneInfo {
    parse_phone(&number, Some("ID"))
}

#[tauri::command]
fn haversine_native(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    haversine_m(lat1, lng1, lat2, lng2)
}

#[tauri::command]
fn osint_targets_native(username: String) -> Vec<OsintPlatformTarget> {
    build_osint_targets(&username)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            analyze_phone_native,
            haversine_native,
            osint_targets_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
