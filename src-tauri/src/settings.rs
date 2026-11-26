use crate::language::Language;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Roam,
    Follow,
    Observe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Other,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Other
        }
    }
}

pub const SPIDER_PRESETS: &[&str] = &[
    "black-widow",
    "redknee",
    "peacock",
    "wandering",
    "funnel-web",
    "wolf",
    "golden-orb",
    "goliath",
    "huntsman",
    "crab",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub platform: Platform,
    pub language: Language,
    pub mode: Mode,
    pub speed: f64,
    pub size: f64,
    pub color: Option<String>,
    pub preset: Option<String>,
    pub paused: bool,
    pub feet: bool,
    pub dark: bool,
    pub visible: bool,
    pub whole_screen: bool,
    pub allow_cross_screen: bool,
    pub avoid_pointer: bool,
    pub auto_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            platform: Platform::current(),
            language: Language::system(),
            mode: Mode::Roam,
            speed: 1.25,
            size: 0.5,
            color: None,
            preset: None,
            paused: false,
            feet: false,
            dark: false,
            visible: true,
            whole_screen: false,
            allow_cross_screen: true,
            avoid_pointer: true,
            auto_start: crate::autostart::is_enabled(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Command {
    Mode(Mode),
    Speed(f64),
    Size(f64),
    Color(Option<String>),
    Preset(Option<String>),
    Paused(bool),
    Feet(bool),
    Dark(bool),
    Visible(bool),
    WholeScreen(bool),
    AllowCrossScreen(bool),
    AvoidPointer(bool),
    AutoStart(bool),
}

impl Settings {
    pub fn apply(&mut self, command: Command) -> Result<(), String> {
        match command {
            Command::Mode(value) => self.mode = value,
            Command::Speed(value) => self.speed = range(value, 0.35, 3.0)?,
            Command::Size(value) => self.size = range(value, 0.35, 2.1)?,
            Command::Color(value) => {
                self.color = validate_color(value)?;
                self.preset = None;
            }
            Command::Preset(value) => {
                self.preset = validate_preset(value)?;
                self.color = None;
            }
            Command::Paused(value) => self.paused = value,
            Command::Feet(value) => self.feet = value,
            Command::Dark(value) => self.dark = value,
            Command::Visible(value) => self.visible = value,
            Command::WholeScreen(value) => self.whole_screen = value,
            Command::AllowCrossScreen(value) => self.allow_cross_screen = value,
            Command::AvoidPointer(value) => self.avoid_pointer = value,
            Command::AutoStart(value) => self.auto_start = value,
        }
        Ok(())
    }
}

fn validate_color(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let bytes = trimmed.as_bytes();
    if bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit()) {
        Ok(Some(trimmed.to_ascii_lowercase()))
    } else {
        Err("Color must be a #RRGGBB hex string or null".into())
    }
}

fn validate_preset(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }
    if SPIDER_PRESETS.contains(&normalized.as_str()) {
        Ok(Some(normalized))
    } else {
        Err("Unknown spider color preset".into())
    }
}

fn range(value: f64, min: f64, max: f64) -> Result<f64, String> {
    if value.is_finite() && (min..=max).contains(&value) {
        Ok(value)
    } else {
        Err(format!("Value must be finite and between {min} and {max}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_values_do_not_change_settings() {
        let mut settings = Settings::default();
        for value in [f64::NAN, f64::INFINITY, -1.0, 3.01] {
            assert!(settings.apply(Command::Speed(value)).is_err());
            assert_eq!(settings.speed, 1.25);
        }
        assert!(settings.apply(Command::Size(2.11)).is_err());
        assert_eq!(settings.size, 0.5);
        for value in [0.35, 3.0] {
            settings.apply(Command::Speed(value)).unwrap();
            assert_eq!(settings.speed, value);
        }
        for value in [0.35, 2.1] {
            settings.apply(Command::Size(value)).unwrap();
            assert_eq!(settings.size, value);
        }
    }

    #[test]
    fn color_setting_validates_hex_and_resets_to_default() {
        let mut settings = Settings::default();
        assert_eq!(settings.color, None);
        settings
            .apply(Command::Color(Some("#C83E37".into())))
            .unwrap();
        assert_eq!(settings.color.as_deref(), Some("#c83e37"));

        for invalid in ["#fff", "red", "123456", "#12345g", "#1234567"] {
            assert!(settings
                .apply(Command::Color(Some(invalid.into())))
                .is_err());
            assert_eq!(settings.color.as_deref(), Some("#c83e37"));
        }

        settings.apply(Command::Color(None)).unwrap();
        assert_eq!(settings.color, None);
        settings
            .apply(Command::Color(Some("#2e8b57".into())))
            .unwrap();
        settings.apply(Command::Color(Some("".into()))).unwrap();
        assert_eq!(settings.color, None);
    }

    #[test]
    fn preset_setting_validates_known_spiders_and_interoperates_with_color() {
        let mut settings = Settings::default();
        assert_eq!(SPIDER_PRESETS.len(), 10);
        for &id in SPIDER_PRESETS {
            settings.apply(Command::Preset(Some(id.into()))).unwrap();
            assert_eq!(settings.preset.as_deref(), Some(id));
            assert_eq!(settings.color, None);
        }
        assert!(settings
            .apply(Command::Preset(Some("unknown-spider".into())))
            .is_err());
        assert_eq!(settings.preset.as_deref(), Some("crab"));

        settings
            .apply(Command::Color(Some("#c83e37".into())))
            .unwrap();
        assert_eq!(settings.color.as_deref(), Some("#c83e37"));
        assert_eq!(settings.preset, None);
        settings
            .apply(Command::Preset(Some("peacock".into())))
            .unwrap();
        assert_eq!(settings.preset.as_deref(), Some("peacock"));
        assert_eq!(settings.color, None);
        settings.apply(Command::Color(None)).unwrap();
        assert_eq!(settings.preset, None);
        assert_eq!(settings.color, None);
    }
}
