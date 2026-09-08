import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Acheminement des e-mails.
 *
 * Trois voies possibles selon la configuration : l'API HTTP de Resend, un
 * serveur SMTP, ou rien du tout. Le choix se fait au chargement du module, d'ou
 * les rechargements ci-dessous : c'est la seule facon d'eprouver les trois.
 *
 * Ce qui est verifie surtout, c'est la version texte du message. Un e-mail HTML
 * seul est un signal negatif fort pour les filtres anti-spam, et c'est l'un des
 * rares leviers de delivrabilite qui se joue dans le code plutot que dans le DNS.
 */

/** Recharge `mailer` avec la configuration demandee. */
async function mailerAvec(env: Record<string, string>) {
  for (const [cle, valeur] of Object.entries(env)) vi.stubEnv(cle, valeur);
  vi.resetModules();
  return import('@/lib/mailer');
}

const MESSAGE = {
  to: 'arthur@alpha.fr',
  subject: 'Invitation',
  html: '<div><p>Bonjour <strong>Arthur</strong>,</p><p>Cliquez ici : <a href="https://app.getbuildr.fr/invite/abc">Accepter l&#39;invitation</a></p></div>',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Sans configuration', () => {
  it("n'echoue pas et ne sort pas sur le reseau", async () => {
    // C'est la situation en developpement et en test : on ne veut ni erreur ni
    // envoi reel.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { sendMail } = await mailerAvec({ RESEND_API_KEY: '', SMTP_HOST: '' });

    await expect(sendMail(MESSAGE)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Via Resend', () => {
  /** Intercepte l'appel HTTP et renvoie le corps envoye. */
  async function envoyer(reponse: { ok: boolean; status?: number; texte?: string } = { ok: true }) {
    const appels: { url: string; corps: Record<string, string> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      appels.push({ url: String(url), corps: JSON.parse(String(init?.body ?? '{}')) });
      return {
        ok: reponse.ok,
        status: reponse.status ?? 200,
        text: async () => reponse.texte ?? '',
      } as unknown as Response;
    });

    const { sendMail } = await mailerAvec({ RESEND_API_KEY: 'cle-resend', SMTP_FROM: 'noreply@getbuildr.fr' });
    return { sendMail, appels };
  }

  it("est prefere au SMTP quand les deux sont configures", async () => {
    const appels: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      appels.push(String(url));
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    });
    const { sendMail } = await mailerAvec({ RESEND_API_KEY: 'cle', SMTP_HOST: 'smtp.exemple.fr' });

    await sendMail(MESSAGE);

    expect(appels[0]).toContain('api.resend.com');
  });

  it('envoie le destinataire, l objet et le HTML', async () => {
    const { sendMail, appels } = await envoyer();

    await sendMail(MESSAGE);

    expect(appels).toHaveLength(1);
    expect(appels[0].corps).toMatchObject({
      to: 'arthur@alpha.fr',
      subject: 'Invitation',
      html: MESSAGE.html,
    });
  });

  it('accompagne toujours le HTML d une version texte', async () => {
    const { sendMail, appels } = await envoyer();

    await sendMail(MESSAGE);

    const texte = appels[0].corps.text;
    expect(texte).toBeTruthy();
    expect(texte).not.toContain('<');
    expect(texte).toContain('Bonjour Arthur,');
  });

  it('rend les liens lisibles en texte brut', async () => {
    // Un lien sans son adresse est inutilisable dans un client texte.
    const { sendMail, appels } = await envoyer();

    await sendMail(MESSAGE);

    expect(appels[0].corps.text).toContain("Accepter l'invitation (https://app.getbuildr.fr/invite/abc)");
  });

  it('retablit les entites HTML dans la version texte', async () => {
    const { sendMail, appels } = await envoyer();

    await sendMail({ ...MESSAGE, html: '<p>Dupont &amp; Fils&nbsp;: l&#39;entreprise</p>' });

    expect(appels[0].corps.text).toBe("Dupont & Fils : l'entreprise");
  });

  it('donne un expediteur nomme plutot qu une adresse nue', async () => {
    // Les clients mail l'affichent tel quel : un expediteur anonyme inspire
    // moins confiance, au destinataire comme au filtre.
    const { sendMail, appels } = await envoyer();

    await sendMail(MESSAGE);

    expect(appels[0].corps.from).toBe('Buildr <noreply@getbuildr.fr>');
  });

  it("respecte un expediteur deja nomme dans la configuration", async () => {
    const appels: { corps: Record<string, string> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      appels.push({ corps: JSON.parse(String(init?.body ?? '{}')) });
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    });
    const { sendMail } = await mailerAvec({
      RESEND_API_KEY: 'cle',
      SMTP_FROM: 'Buildr Chantiers <bonjour@getbuildr.fr>',
    });

    await sendMail(MESSAGE);

    expect(appels[0].corps.from).toBe('Buildr Chantiers <bonjour@getbuildr.fr>');
  });

  it('signale un refus du fournisseur plutot que de le taire', async () => {
    // Un e-mail perdu en silence est pire qu'une erreur : personne ne saurait
    // que l'invitation n'est jamais partie.
    const { sendMail } = await envoyer({ ok: false, status: 422, texte: 'domaine non verifie' });

    await expect(sendMail(MESSAGE)).rejects.toThrow(/422/);
  });
});
