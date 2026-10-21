import { passwordHash } from '../../src/lib/research/server.mjs';
import { randomBytes } from 'node:crypto';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const password=Buffer.concat(chunks).toString().replace(/\r?\n$/,'');
if(!password)throw new Error('Передайте пароль через стандартный ввод, не аргумент командной строки.');
console.log(JSON.stringify({RESEARCH_OWNER_PASSWORD_HASH:passwordHash(password),RESEARCH_SESSION_SECRET:randomBytes(32).toString('base64url')},null,2));
