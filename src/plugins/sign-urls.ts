import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { signUrlsDeep } from '@/lib/sign-url';

/**
 * Signe les URLs de fichiers de toutes les reponses JSON.
 *
 * Historiquement chaque module devait penser a appeler signUrlsInList sur ses
 * propres reponses. Trois l'ont fait, les autres non : les photos d'urgence,
 * les avatars et les logos d'organisation partaient sans token et le client
 * n'affichait qu'une image vide, sans erreur exploitable.
 *
 * Le hook rend l'oubli impossible : toute chaine pointant vers /files/ est
 * signee au moment de la serialisation, ou qu'elle se trouve dans la reponse.
 * La signature est idempotente, les appels explicites qui subsistent dans les
 * modules restent donc sans effet de bord.
 */
async function signUrlsPlugin(fastify: FastifyInstance) {
  fastify.addHook('preSerialization', async (_request, _reply, payload) => signUrlsDeep(payload));
}

export default fp(signUrlsPlugin, { name: 'sign-urls' });
