// Run: node test/pii.test.js
const { scanText } = require('../pii');

const cases = [
  // --- must detect ------------------------------------------------------
  ['my key is sk-ant-api03-AbCdEf123456789', ['anthropic-key']],
  ['OPENAI_KEY=sk-proj4bCdEf123456789012345', ['openai-key', 'secret-assignment']],
  ['token ghp_AbCdEfGh1234567890IjKl', ['github-token']],
  ['github_pat_11ABCDEFG0abcdefghijklmnop', ['github-token']],
  ['aws AKIAIOSFODNN7EXAMPLE', ['aws-key']],
  ['aws_secret_access_key = wJalrXUtnFEMI', ['aws-key']],
  ['stripe sk_live_4eC39HqLyjWDarjtT1zdp7dc', ['stripe-key']],
  ['slack xoxb-123456789-abcdefghij', ['slack-token']],
  ['maps key AIzaSyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU', ['google-key']],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow...', ['private-key']],
  ['postgres://admin:hunter2@db.neon.tech/main', ['db-connection']],
  ['mongodb+srv://root:pa55word@cluster0.mongodb.net', ['db-connection']],
  ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', ['jwt']],
  ['curl -H "Authorization: Bearer abc123def456ghi789jkl012"', ['bearer-token']],
  ['DB_PASSWORD=sup3rsecret99', ['secret-assignment']],
  ['test card 4111 1111 1111 1111', ['card-number']],
  ['GB29 NWBK 6016 1331 9268 19', ['iban']],
  ['sort code 12-34-56 account 12345678', ['uk-bank']],
  ['NI: AB 12 34 56 C', ['uk-nino']],
  ['ssn 078-05-1120', ['ssn']],
  ['reach me at jack@example.co.uk please', ['email']],
  ['call 07911 123 456 tomorrow', ['phone']],
  ['dob 14/03/1998 for the form', ['dob']],
  // third-party personal data: caught before Send
  ['Patient: Sarah Connor, DOB 14/03/1985, diagnosed with type 2 diabetes, prescribed metformin', ['third-party-health', 'dob']],
  ['referral for NHS number 943 476 5919', ['third-party-health']],
  ['Year 7 class list. Emma Wilson: A*, Jacob Miles: B', ['childrens-data']],
  ['Emma Wilson: A*, Jacob Miles: B, Priya Patel: 68%', ['childrens-data']],
  ["Draft Mark Reed's appraisal from these notes, absence record attached", ['hr-record']],
  ['John Smith john.smith@acme.com\nJane Doe jane.doe@acme.com\nRob Brown rob.brown@acme.com', ['bulk-personal-records', 'email']],

  // --- must NOT detect (false-positive traps) ---------------------------
  ['just a normal sentence about drippy the blob', []],
  ['const token = getToken();', []],
  ['the password field should be required', []],
  ['I was born in London and love hiking', []], // "born" without a date
  ['meeting on 14/03/2026 at noon', []], // date without dob context
  ['see docs at https://example.com/skills?page=2', []],
  ['pi is 3.14159265358979323846', []],
  ['version 12-34-56 of the sorting library', []], // digits without "sort code"
  ['use process.env.API_KEY instead', []],
  ['npm install @anthropic-ai/sdk', []],
  ['how would a patient with early diabetes symptoms usually be treated', []], // no identifiable person
  ['Jane Austen wrote about mental health in her novels', []], // clinical word + name, no identifier
  ['draft a generic performance review template for engineers', []], // HR context, nobody named
  ['meet John Smith and Jane Doe at the product launch', []], // names without identifiers
  ['the pupils enjoyed the trip to York Museum', []], // school context, no records
];

let fails = 0;
for (const [text, want] of cases) {
  const got = scanText(text).map((c) => c.id);
  const ok = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());
  if (!ok) {
    fails++;
    console.log('FAIL:', JSON.stringify(text.slice(0, 60)), '→', got, 'want', want);
  }
}
console.log(fails === 0 ? `all ${cases.length} PII cases pass` : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
