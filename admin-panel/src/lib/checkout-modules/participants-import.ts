/** Parses pasted lists and CSV files into participant rows. @see ./participants.ts */
export interface ImportedPerson { first_name: string; last_name: string; email: string }
export interface ParticipantImport { people: ImportedPerson[]; skipped: number; overflow: number }

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function cells(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { result.push(current.trim()); current = ''; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

function toPerson(line: string): ImportedPerson | 'header' | null {
  const parts = cells(line).filter(Boolean);
  let email = parts.find(part => EMAIL.test(part));
  if (!email && parts.length === 1) {
    const words = parts[0].split(/\s+/);
    email = words.find(word => EMAIL.test(word));
    if (email) parts.splice(0, 1, ...words);
  }
  if (!email) return parts.length >= 2 || parts.length === 1 && /mail/i.test(parts[0]) ? 'header' : null;
  const names = parts.filter(part => part !== email);
  if (names.length >= 2) return { first_name: names[0], last_name: names.slice(1).join(' '), email };
  const words = (names[0] ?? '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return { first_name: words[0], last_name: words.slice(1).join(' '), email };
}

export function parseParticipantList(text: string, quantity: number): ParticipantImport {
  const people: ImportedPerson[] = [];
  let skipped = 0;
  let overflow = 0;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const parsed = toPerson(line);
    if (parsed === 'header') { if (index > 0) skipped++; return; }
    if (!parsed) { skipped++; return; }
    if (people.length >= quantity) overflow++; else people.push(parsed);
  });
  return { people, skipped, overflow };
}
