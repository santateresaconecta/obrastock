// =============================================================================
// ObraStock — gestão de usuários (Edge Function)
// =============================================================================
// Criar um login exige a chave service_role, que ignora toda a segurança do
// banco. Ela NUNCA pode estar no navegador. Por isso esta função: ela roda no
// servidor do Supabase, guarda a chave lá, e só aceita pedidos de quem está
// na tabela `desenvolvedores`.
//
// Publicar:
//   npx supabase functions deploy admin-usuarios --project-ref SEU-REF
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente da função —
// não precisa configurar nada.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);

  const URL_SB  = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

  // ---------------------------------------------------------------------
  // 1. Quem está pedindo?
  // ---------------------------------------------------------------------
  const cabecalho = req.headers.get('Authorization') ?? '';
  const token = cabecalho.replace('Bearer ', '').trim();
  if (!token) return json({ erro: 'Não autenticado.' }, 401);

  const { data: { user }, error: erroUser } = await admin.auth.getUser(token);
  if (erroUser || !user) return json({ erro: 'Sessão inválida.' }, 401);

  // ---------------------------------------------------------------------
  // 2. É desenvolvedor?
  //    A lista vive no banco, não aqui — assim dá para revogar um acesso sem
  //    republicar a função.
  // ---------------------------------------------------------------------
  const { data: dev } = await admin
    .from('desenvolvedores')
    .select('email')
    .ilike('email', user.email ?? '')
    .maybeSingle();

  if (!dev) {
    console.warn('Acesso negado à gestão de usuários:', user.email);
    return json({ erro: 'Esta área é restrita ao desenvolvedor do sistema.' }, 403);
  }

  // ---------------------------------------------------------------------
  // 3. Executar
  // ---------------------------------------------------------------------
  let corpo: Record<string, any>;
  try { corpo = await req.json(); }
  catch { return json({ erro: 'Pedido inválido.' }, 400); }

  const acao = String(corpo.acao ?? '');

  try {
    switch (acao) {

      // ---------- listar a equipe de uma empresa ----------
      case 'listar': {
        let q = admin.from('perfis')
          .select('id, nome, cargo, papel, ativo, empresa_id, criado_em, empresas(nome)')
          .order('nome');
        if (corpo.empresaId) q = q.eq('empresa_id', corpo.empresaId);

        const { data, error } = await q;
        if (error) throw error;

        // o e-mail não está em `perfis`, vem de auth.users
        const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const emails = new Map((lista?.users ?? []).map(u => [u.id, u.email]));
        const ultimoAcesso = new Map((lista?.users ?? []).map(u => [u.id, u.last_sign_in_at]));

        return json({
          usuarios: (data ?? []).map(p => ({
            ...p,
            email: emails.get(p.id) ?? null,
            ultimoAcesso: ultimoAcesso.get(p.id) ?? null,
            empresaNome: (p as any).empresas?.nome ?? null,
          })),
        });
      }

      // ---------- empresas, para o seletor ----------
      case 'empresas': {
        const { data, error } = await admin.from('empresas').select('id, nome').order('nome');
        if (error) throw error;
        return json({ empresas: data });
      }

      // ---------- criar usuário ----------
      case 'criar': {
        const email = String(corpo.email ?? '').trim().toLowerCase();
        const nome  = String(corpo.nome ?? '').trim();
        const papel = String(corpo.papel ?? 'estoquista');
        const cargo = String(corpo.cargo ?? '').trim() || null;
        const empresaId = corpo.empresaId;

        if (!email || !nome) return json({ erro: 'Informe nome e e-mail.' }, 400);
        if (!empresaId)      return json({ erro: 'Escolha a empresa.' }, 400);
        if (!['admin', 'estoquista', 'visualizador'].includes(papel))
          return json({ erro: 'Papel inválido.' }, 400);

        // Senha provisória forte. O usuário troca no primeiro acesso pelo
        // link de redefinição — ninguém precisa ditar senha por telefone.
        const provisoria = crypto.randomUUID() + 'Aa1!';

        const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
          email,
          password: provisoria,
          email_confirm: true,
          user_metadata: { nome, cargo },
        });

        if (erroCriar) {
          const m = erroCriar.message ?? '';
          if (/already been registered|already exists/i.test(m))
            return json({ erro: 'Já existe um usuário com este e-mail.' }, 409);
          throw erroCriar;
        }

        // O trigger fn_novo_usuario cria empresa e perfil sozinho. Aqui
        // corrigimos para a empresa certa e o papel escolhido.
        const { error: erroPerfil } = await admin
          .from('perfis')
          .update({ empresa_id: empresaId, nome, cargo, papel, ativo: true })
          .eq('id', criado.user.id);

        if (erroPerfil) {
          // não deixa um login órfão sem perfil utilizável
          await admin.auth.admin.deleteUser(criado.user.id);
          throw erroPerfil;
        }

        // remove a empresa vazia que o trigger criou para este usuário
        if (corpo.limparEmpresaOrfa !== false) {
          await admin.rpc('fn_limpar_empresas_vazias').catch(() => {});
        }

        // convite para definir a senha
        const { error: erroLink } = await admin.auth.resetPasswordForEmail(email, {
          redirectTo: String(corpo.redirectTo ?? ''),
        });

        return json({
          ok: true,
          id: criado.user.id,
          avisoEmail: erroLink ? 'Usuário criado, mas o e-mail de senha não saiu. Use "Reenviar convite".' : null,
        });
      }

      // ---------- alterar papel, cargo, nome ou situação ----------
      case 'atualizar': {
        const id = String(corpo.id ?? '');
        if (!id) return json({ erro: 'Usuário não informado.' }, 400);

        const patch: Record<string, unknown> = {};
        if (corpo.nome  !== undefined) patch.nome  = String(corpo.nome).trim();
        if (corpo.cargo !== undefined) patch.cargo = String(corpo.cargo).trim() || null;
        if (corpo.ativo !== undefined) patch.ativo = !!corpo.ativo;
        if (corpo.papel !== undefined) {
          if (!['admin', 'estoquista', 'visualizador'].includes(String(corpo.papel)))
            return json({ erro: 'Papel inválido.' }, 400);
          patch.papel = corpo.papel;
        }
        if (corpo.empresaId !== undefined) patch.empresa_id = corpo.empresaId;

        if (!Object.keys(patch).length) return json({ erro: 'Nada para alterar.' }, 400);

        // Proteção contra tiro no pé: não dá para desativar a si mesmo.
        if (id === user.id && patch.ativo === false)
          return json({ erro: 'Você não pode desativar o próprio acesso.' }, 400);

        const { error } = await admin.from('perfis').update(patch).eq('id', id);
        if (error) throw error;
        return json({ ok: true });
      }

      // ---------- reenviar convite / redefinir senha ----------
      case 'convite': {
        const email = String(corpo.email ?? '').trim().toLowerCase();
        if (!email) return json({ erro: 'E-mail não informado.' }, 400);
        const { error } = await admin.auth.resetPasswordForEmail(email, {
          redirectTo: String(corpo.redirectTo ?? ''),
        });
        if (error) throw error;
        return json({ ok: true });
      }

      // ---------- remover de vez ----------
      case 'remover': {
        const id = String(corpo.id ?? '');
        if (!id) return json({ erro: 'Usuário não informado.' }, 400);
        if (id === user.id) return json({ erro: 'Você não pode remover o próprio acesso.' }, 400);

        const { error } = await admin.auth.admin.deleteUser(id);  // perfil cai junto (cascade)
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ erro: 'Ação desconhecida: ' + acao }, 400);
    }
  } catch (e) {
    console.error('[admin-usuarios]', acao, e);
    return json({ erro: (e as Error).message ?? 'Erro inesperado.' }, 500);
  }
});
