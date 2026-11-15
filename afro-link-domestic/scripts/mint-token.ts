import { signToken, ActorRole } from '../src/auth';

const [roleArg, subjectArg, nameArg] = process.argv.slice(2);

const ROLES: ActorRole[] = ['shipper', 'operator', 'admin'];

if (!roleArg || !ROLES.includes(roleArg as ActorRole) || !subjectArg) {
  console.error('Usage: npx tsx scripts/mint-token.ts <shipper|operator|admin> <subject> [name]');
  process.exit(1);
}

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error('AUTH_SECRET must be set (the same secret the API verifies with).');
  process.exit(1);
}

const token = signToken({ subject: subjectArg, role: roleArg as ActorRole, name: nameArg }, secret);
console.log(token);
