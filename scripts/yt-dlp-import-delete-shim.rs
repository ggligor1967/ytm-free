use std::env;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: &str = "step6r3b1-shim-1";
const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
const INVALID_HANDLE_VALUE: isize = -1;

#[repr(C)]
#[allow(non_snake_case)]
struct ProcessEntry32W {
    dwSize: u32,
    cntUsage: u32,
    th32ProcessID: u32,
    th32DefaultHeapID: usize,
    th32ModuleID: u32,
    cntThreads: u32,
    th32ParentProcessID: u32,
    pcPriClassBase: i32,
    dwFlags: u32,
    szExeFile: [u16; 260],
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
    fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

fn parent_process_id() -> u32 {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return 0;
    }

    let mut entry = ProcessEntry32W {
        dwSize: std::mem::size_of::<ProcessEntry32W>() as u32,
        cntUsage: 0,
        th32ProcessID: 0,
        th32DefaultHeapID: 0,
        th32ModuleID: 0,
        cntThreads: 0,
        th32ParentProcessID: 0,
        pcPriClassBase: 0,
        dwFlags: 0,
        szExeFile: [0; 260],
    };

    let current = process::id();
    let mut parent = 0;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        if entry.th32ProcessID == current {
            parent = entry.th32ParentProcessID;
            break;
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe {
        CloseHandle(snapshot);
    }
    parent
}

fn civil_date_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn utc_timestamp() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_seconds = elapsed.as_secs() as i64;
    let days = total_seconds / 86_400;
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_date_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z",
        elapsed.subsec_millis()
    )
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character < ' ' => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn validate_run_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn append_ledger(
    evidence_root: &str,
    argv: &[String],
    classification: &str,
    exit_code: i32,
) -> Result<(), String> {
    let root = PathBuf::from(evidence_root);
    create_dir_all(&root).map_err(|error| format!("cannot create evidence root: {error}"))?;
    let ledger_path = root.join("yt-dlp-invocations.jsonl");
    let mut ledger = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ledger_path)
        .map_err(|error| format!("cannot open ledger: {error}"))?;
    let argv_json = argv
        .iter()
        .map(|argument| format!("\"{}\"", json_escape(argument)))
        .collect::<Vec<_>>()
        .join(",");
    let line = format!(
        "{{\"timestamp_utc\":\"{}\",\"shim_pid\":{},\"parent_pid\":{},\"argv\":[{}],\"classification\":\"{}\",\"exit_code\":{}}}\n",
        utc_timestamp(),
        process::id(),
        parent_process_id(),
        argv_json,
        json_escape(classification),
        exit_code
    );
    ledger
        .write_all(line.as_bytes())
        .map_err(|error| format!("cannot append ledger: {error}"))?;
    ledger
        .flush()
        .map_err(|error| format!("cannot flush ledger: {error}"))
}

fn search_arguments(token: &str, track: &str) -> Vec<String> {
    vec![
        "--dump-json".to_owned(),
        "--flat-playlist".to_owned(),
        "--no-warnings".to_owned(),
        "--ignore-errors".to_owned(),
        format!("ytsearch5:Step6R3B1 Synthetic Artist Step6R3B1 {track} {token}"),
    ]
}

fn output_json(track: &str, token: &str) -> String {
    let (id, duration) = if track == "Alpha" {
        ("s6R3B1A001", 123)
    } else {
        ("s6R3B1B001", 234)
    };
    format!(
        "{{\"id\":\"{id}\",\"title\":\"Step6R3B1 {track} {}\",\"channel\":\"Step6R3B1 Synthetic Artist\",\"duration\":{duration},\"thumbnail\":\"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=\"}}",
        json_escape(token)
    )
}

fn run() -> i32 {
    let argv: Vec<String> = env::args().skip(1).collect();
    let evidence_root = match env::var("EVIDENCE_ROOT") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("EVIDENCE_ROOT is required");
            return 78;
        }
    };
    let run_token = match env::var("RUN_TOKEN") {
        Ok(value) if validate_run_token(&value) => value,
        _ => {
            eprintln!("RUN_TOKEN must contain only ASCII letters, digits, or hyphens");
            return 78;
        }
    };

    let (classification, exit_code, stdout_value) = if argv == ["--version"] {
        ("version", 0, Some(VERSION.to_owned()))
    } else if argv == search_arguments(&run_token, "Alpha") {
        ("search-alpha", 0, Some(output_json("Alpha", &run_token)))
    } else if argv == search_arguments(&run_token, "Beta") {
        ("search-beta", 0, Some(output_json("Beta", &run_token)))
    } else {
        ("unexpected", 64, None)
    };

    if let Err(error) = append_ledger(&evidence_root, &argv, classification, exit_code) {
        eprintln!("{error}");
        return 74;
    }

    if let Some(value) = stdout_value {
        println!("{value}");
    } else {
        eprintln!("UNEXPECTED-YT-DLP-INVOCATION: unsupported argv");
    }
    exit_code
}

fn main() {
    process::exit(run());
}
