import bcrypt from 'bcryptjs';

// Admin passwords are hashed (bcrypt, salted, one-way) rather than encrypted
// with a reversible cipher - a leaked key would decrypt every password at
// once, while a leaked hash still costs an attacker a brute-force per
// account. This is the one column in the DB that ever holds password-derived
// data (see employees.password_hash), and it never holds anything decryptable
// back to plaintext.
const SALT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
