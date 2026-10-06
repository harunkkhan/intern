// Deciding whether a posting is based in the US.
//
// Sources describe locations in wildly different ways — "San Francisco, CA",
// "US, CA, Santa Clara", "Bellevue, Washington; Mountain View, California",
// "Flexible - Any SpaceX Site", "Remote", "London, UK", "Costa Rica", or nothing
// at all — so this works on country and state/province tokens, plus a short list
// of unambiguous Canadian cities. City names are genuinely ambiguous: Vancouver is in both Washington and
// British Columbia, Ontario is both a Canadian province and a city in California,
// London is in both the UK and Ontario, and Cambridge, Birmingham and Waterloo
// all exist on multiple continents.

export type Region = "us" | "canada" | "foreign" | "unknown";

// Non-English hiring-market markers. These are the only reliable signal for
// postings whose stated location is missing or ambiguous: IBM's
// "Cloud Duales Studium 2027 Bachelor@IBM ... (f,m,x)" is unmistakably a German
// listing, and its location read "Ehningen, DE" — where DE is Germany, but also
// Delaware's postal code, so the state-code check classified it as US.
const FOREIGN_LANGUAGE =
  /\b(duales\s+studium|werkstudent\w*|praktikum|praktikant\w*|ausbildung|stage\s+(?:de|en)\b|alternance|stagiaire|becario|becaria|pr[áa]cticas|est[áa]gio|estagi[áa]rio|tirocinio|stagista|praktyka|praktykant|st[aá][zž]|\(m\/w\/d\)|\(w\/m\/d\)|\(f\/m\/d\)|\(f,m,x\)|\(m\/f\/d\)|h\/f\b)/i;

// Checked first, so anything overlapping resolves to foreign. Countries and
// unambiguously non-North-American metros only — never a city that also exists in
// the US or Canada.
const FOREIGN =
  /\b(united\s+kingdom|uk|england|scotland|wales|northern\s+ireland|ireland|eire|france|germany|deutschland|netherlands|holland|belgium|luxembourg|switzerland|austria|spain|portugal|italy|greece|turkey|poland|czechia|czech\s+republic|slovakia|hungary|romania|bulgaria|serbia|croatia|slovenia|denmark|sweden|norway|finland|iceland|estonia|latvia|lithuania|ukraine|russia|israel|palestine|jordan|lebanon|saudi\s+arabia|uae|united\s+arab\s+emirates|qatar|kuwait|bahrain|oman|egypt|morocco|tunisia|nigeria|kenya|ghana|south\s+africa|india|pakistan|bangladesh|sri\s+lanka|nepal|china|prc|hong\s+kong|macau|taiwan|japan|nippon|south\s+korea|korea|singapore|malaysia|indonesia|thailand|vietnam|philippines|australia|new\s+zealand|brazil|brasil|argentina|chile|colombia|peru|uruguay|ecuador|venezuela|bolivia|paraguay|costa\s+rica|panama|guatemala|honduras|nicaragua|el\s+salvador|dominican\s+republic|puerto\s+rico|jamaica|trinidad|emea|apac|latam|europe|asia|africa|middle\s+east|oceania|international)\b|\b(london(?!\s*,?\s*(on|ont|ontario))|dublin|edinburgh|manchester|glasgow|bristol|leeds|cambridge\s*,?\s*uk|oxford\s*,?\s*uk|paris|lyon|toulouse|berlin|munich|münchen|frankfurt|hamburg|cologne|stuttgart|düsseldorf|dusseldorf|amsterdam|rotterdam|utrecht|eindhoven|brussels|antwerp|zurich|zürich|geneva|basel|lausanne|vienna|wien|madrid|barcelona|valencia|lisbon|porto|milan|milano|rome|roma|turin|athens|istanbul|ankara|warsaw|krakow|kraków|wroclaw|wrocław|gdansk|prague|praha|brno|bratislava|budapest|bucharest|sofia|belgrade|zagreb|ljubljana|copenhagen|københavn|stockholm|gothenburg|oslo|helsinki|reykjavik|tallinn|riga|vilnius|kyiv|kiev|moscow|st\.?\s*petersburg|tel\s*aviv|jerusalem|haifa|herzliya|ra'?anana|dubai|abu\s*dhabi|doha|riyadh|jeddah|cairo|casablanca|nairobi|lagos|johannesburg|cape\s*town|pretoria|bangalore|bengaluru|hyderabad|mumbai|bombay|delhi|new\s*delhi|gurgaon|gurugram|noida|pune|chennai|kolkata|ahmedabad|karachi|lahore|islamabad|dhaka|colombo|kathmandu|shanghai|beijing|peking|shenzhen|guangzhou|hangzhou|chengdu|wuhan|xian|taipei|hsinchu|seoul|busan|incheon|tokyo|osaka|kyoto|yokohama|nagoya|fukuoka|kuala\s*lumpur|penang|jakarta|bandung|bangkok|hanoi|ho\s*chi\s*minh|saigon|manila|cebu|sydney|melbourne|brisbane|perth|adelaide|canberra|auckland|wellington|christchurch|são\s*paulo|sao\s*paulo|rio\s*de\s*janeiro|brasilia|belo\s*horizonte|buenos\s*aires|córdoba|cordoba|santiago|bogota|bogotá|medellin|medellín|lima|montevideo|quito|caracas|guadalajara|monterrey|mexico\s*city|ciudad\s*de\s*méxico|san\s*jos[eé]\s*,?\s*(cr|costa)|heredia|cartago)\b/i;

// Whole-footprint phrases that name the US outright, including region-wide ones
// that also cover Canada: "Remote - North America", "US/Canada", "Remote in US or
// Canada". Checked before Canada, since all of those mention it.
const US_COUNTRY =
  /(?<!\w)(united\s+states|u\.s\.(?:a\.)?|usa|north\s+america)(?!\w)/i;
const US_COUNTRY_CODE = /(?:^|[,\s(\-–/])(US|USA)(?=$|[,\s)\-–/;])/;

// "Ontario, CA" alone is Ontario, California, not the province.
const ONTARIO_CALIFORNIA = /^ontario\s*,\s*(ca|california)(?!\w)/i;

// Canadian names that are unambiguous on their own. Vancouver, London, Cambridge,
// Kingston, Hamilton, Windsor and Victoria are deliberately absent: they only
// count as Canada through a province or "Canada" qualifier.
const CANADA_NAME =
  /(?<!\w)(canada|canadian|alberta|british\s+columbia|manitoba|new\s+brunswick|newfoundland|nova\s+scotia|ontario|prince\s+edward\s+island|quebec|québec|saskatchewan|nunavut|yukon|northwest\s+territories)(?!\w)/i;

// Province codes, only in delimited positions. Checked before "CA" so that
// "Toronto, ON, CA" is not read as California.
const CANADA_CODE =
  /(?:^|[,\s(\-–/])(AB|BC|MB|NB|NL|NS|ON|PE|QC|SK|NT|NU|YT)(?=$|[,\s)\-–/;])/;

// Major cities for city-only strings. Checked after US states, so "Waterloo, IA"
// stays in Iowa.
const CANADA_CITY =
  /(?<!\w)(toronto|montr[eé]al|waterloo|ottawa|calgary|edmonton|mississauga|markham|kitchener|burnaby|winnipeg|halifax)(?!\w)/i;

const US_STATE_NAME =
  /(?<!\w)(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming|district\s+of\s+columbia)(?!\w)/i;
const US_STATE_CODE =
  /(?:^|[,\s(\-–/])(AL|AK|AZ|AR|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?=$|[,\s)\-–/;])/;

// "CA" is California and also ISO for Canada, so it only means the US once every
// Canadian reading has been ruled out.
const CALIFORNIA_CODE = /(?:^|[,\s(\-–/])CA(?=$|[,\s)\-–/;])/;

// Common US shorthand, e.g. "NYC", "SF Bay Area", "Silicon Valley".
const US_SHORTHAND =
  /\b(nyc|new\s*york\s*city|sf\s*bay\s*area|bay\s*area|silicon\s*valley|dmv|socal|norcal)\b/i;

// Region words like "EMEA" and "International" are meaningful in a location
// field but not in a job title — "Intern, International Payments" is a US role.
// Titles are therefore matched against places only.
const FOREIGN_REGION =
  /\b(emea|apac|latam|europe|european|asia|africa|middle\s+east|oceania|international)\b/i;

/** Classifies one location string. */
export function classifyLocation(raw: string): Region {
  const value = raw.trim();
  if (!value) return "unknown";
  // Foreign wins ties: "London, UK" must not be rescued by a stray token.
  if (FOREIGN.test(value) || FOREIGN_LANGUAGE.test(value)) return "foreign";
  if (
    US_COUNTRY.test(value) ||
    US_COUNTRY_CODE.test(value) ||
    ONTARIO_CALIFORNIA.test(value)
  ) {
    return "us";
  }
  // A state other than CA settles it before any Canadian name can: "New
  // Brunswick, NJ" is in New Jersey and "Waterloo, IA" is in Iowa.
  if (
    US_STATE_NAME.test(value) ||
    US_STATE_CODE.test(value) ||
    US_SHORTHAND.test(value)
  ) {
    return "us";
  }
  if (CANADA_NAME.test(value) || CANADA_CODE.test(value) || CANADA_CITY.test(value)) {
    return "canada";
  }
  if (CALIFORNIA_CODE.test(value)) return "us";
  return "unknown";
}

/**
 * Whether a job *title* betrays a posting outside the US and Canada.
 *
 * Needed because location is frequently absent from scraped pages — 14 of 18
 * alerts in one run had none — while the title often says it outright, as in
 * Optiver's "Quantitative Trading Internship (Singapore) - 2027". Matches
 * countries, cities and non-English hiring markers, but deliberately not region
 * words, so "International Payments" in a title is not mistaken for a location.
 */
export function titleLooksForeign(title: string): boolean {
  const stripped = title.replace(FOREIGN_REGION, " ");
  return FOREIGN.test(stripped) || FOREIGN_LANGUAGE.test(title);
}

/**
 * Whether a job title names Canada, as in "Software Intern (Toronto)" or
 * "Data Intern - Canada". Province codes are not matched here; region-wide
 * titles such as "Intern - US/Canada" are not Canadian.
 */
export function titleLooksCanadian(title: string): boolean {
  if (US_COUNTRY.test(title) || US_COUNTRY_CODE.test(title)) return false;
  return CANADA_NAME.test(title) || CANADA_CITY.test(title);
}

/** Classifies each location part, splitting multi-location strings. */
export function locationRegions(locations: string[] | null | undefined): Region[] {
  // Multi-location strings arrive semicolon- or slash-joined from several
  // sources: "Bellevue, Washington; Mountain View, California".
  return (locations ?? [])
    .flatMap((l) => l.split(/[;|]|\s+\/\s+/))
    .map((l) => l.trim())
    .filter(Boolean)
    .map(classifyLocation);
}

/**
 * Whether a posting may be in the US on its stated locations.
 *
 * A listing is rejected only when it states locations and every one of them is
 * positively identifiable as Canada or elsewhere. Anything unknown passes:
 * "Remote", "Flexible - Any SpaceX Site" and a missing field are all common, and
 * dropping them would lose real US roles.
 */
export function mayBeInUs(locations: string[] | null | undefined): boolean {
  const regions = locationRegions(locations);
  return (
    regions.length === 0 ||
    regions.some((region) => region === "us" || region === "unknown")
  );
}
