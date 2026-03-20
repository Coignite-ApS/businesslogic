// Input transforms: preprocess user-facing values into Excel-native values before cell injection
// Output transforms: convert Excel-native values back to user-friendly values

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// Excel epoch: 1900-01-01 = serial 1, includes Lotus 1-2-3 bug (1900-02-29 counted)
function dateToSerial(y, m, d) {
  const ms = Date.UTC(y, m - 1, d);
  const serial = Math.floor(ms / 86400000) + 25569;
  if (serial < 1) throw new Error(`Date out of range: ${y}-${m}-${d}`);
  return serial;
}

function timeToFraction(h, m, s = 0) {
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
    throw new Error(`Invalid time: ${h}:${m}:${s}`);
  }
  return (h * 3600 + m * 60 + s) / 86400;
}

// Reverse: Excel serial → ISO date string
function serialToDate(serial) {
  const ms = (serial - 25569) * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Reverse: fractional day → HH:MM:SS
function fractionToTime(frac) {
  const totalSec = Math.round(frac * 86400);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function applyTransform(type, value) {
  switch (type) {
    case 'date': {
      const m = String(value).match(DATE_RE);
      if (!m) throw new Error(`Invalid date format (expected YYYY-MM-DD): ${value}`);
      return dateToSerial(+m[1], +m[2], +m[3]);
    }
    case 'time': {
      const m = String(value).match(TIME_RE);
      if (!m) throw new Error(`Invalid time format (expected HH:MM or HH:MM:SS): ${value}`);
      return timeToFraction(+m[1], +m[2], +(m[3] || 0));
    }
    case 'datetime': {
      const m = String(value).match(DATETIME_RE);
      if (!m) throw new Error(`Invalid datetime format (expected YYYY-MM-DDTHH:MM:SS): ${value}`);
      return dateToSerial(+m[1], +m[2], +m[3]) + timeToFraction(+m[4], +m[5], +(m[6] || 0));
    }
    case 'percentage':
      if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`Invalid percentage (expected number): ${value}`);
      }
      return value / 100;
    default:
      throw new Error(`Unknown transform: ${type}`);
  }
}

export function applyOutputTransform(type, value) {
  if (value == null || (typeof value === 'object' && value.type)) return value; // null/error passthrough
  switch (type) {
    case 'date':
      return serialToDate(value);
    case 'time':
      return fractionToTime(value);
    case 'datetime': {
      const datePart = Math.floor(value);
      const timePart = value - datePart;
      return serialToDate(datePart) + 'T' + fractionToTime(timePart);
    }
    case 'percentage':
      return value * 100;
    default:
      return value;
  }
}
