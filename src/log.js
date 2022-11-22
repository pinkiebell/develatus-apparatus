const LOGGED = {};

export default function logOnce (str) {
  const msg = `***develatus-apparatus: ${str}***\n`;
  if (!LOGGED[msg]) {
    process.stderr.write(msg);
    LOGGED[msg] = true;
  }
}
