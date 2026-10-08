/* =============================================================================
   ObraStock — Foto do material
   =============================================================================
   Uma foto por material. O arquivo vai para o Storage do Supabase, no caminho

       materiais/<empresa_id>/<material_id>.jpg

   e o endereço fica em materiais.foto_url.

   TRÊS PROBLEMAS QUE ESTE ARQUIVO RESOLVE

   1. Tamanho. Uma foto de celular tem de 3 a 6 MB. Mandar isso inteiro
      gastaria o plano gratuito (1 GB) em ~200 materiais e demoraria no 4G da
      obra. Aqui a imagem é reduzida para 1024 px no lado maior e salva como
      JPEG 75%, o que dá de 80 KB a 200 KB — de 20 a 50 vezes menor.

   2. Foto deitada. O celular quase sempre grava a imagem na horizontal e
      anexa uma etiqueta EXIF dizendo "gire isto". O <img> do navegador
      obedece a etiqueta, mas o canvas NÃO — se a gente desenhasse direto,
      metade das fotos ficaria de lado. Por isso usamos createImageBitmap com
      imageOrientation 'from-image', que aplica o giro antes.

   3. Trocar a foto e continuar vendo a antiga. O caminho do arquivo é sempre
      o mesmo (o id do material), então o navegador reaproveita a imagem do
      cache. Resolvido com um carimbo ?v= na hora de montar o endereço.

   Sem Supabase configurado (protótipo/demonstração), a foto vira um endereço
   data: e funciona do mesmo jeito na tela — o que muda é só onde ela mora.
============================================================================= */

import { getClient, traduzErro } from './supabase.js';
import { CONFIGURADO } from './config.js';

const BALDE     = 'materiais';
const LADO_MAX  = 1024;
const QUALIDADE = 0.75;
const LIMITE    = 2 * 1024 * 1024;   // 2 MB, igual ao limite do balde

/* ---------------------------------------------------------------------------
   Decodificação com a orientação EXIF já aplicada.
   createImageBitmap é o caminho certo; o <img> é a saída para navegador
   antigo, e nele o próprio elemento já corrige a orientação ao desenhar.
--------------------------------------------------------------------------- */
async function decodificar(file){
  if (typeof createImageBitmap === 'function'){
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { /* navegador sem a opção: cai no <img> abaixo */ }
  }
  return await new Promise((ok, erro) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url);
                          erro(new Error('Não foi possível ler esta imagem.')); };
    img.src = url;
  });
}

/** Reduz e recomprime. Devolve um Blob JPEG. */
export async function reduzir(file, ladoMax = LADO_MAX, qualidade = QUALIDADE){
  const img = await decodificar(file);
  const l = img.width, a = img.height;
  const escala = Math.min(1, ladoMax / Math.max(l, a));   // nunca aumenta
  const nl = Math.max(1, Math.round(l * escala));
  const na = Math.max(1, Math.round(a * escala));

  const cv = document.createElement('canvas');
  cv.width = nl; cv.height = na;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, nl, na);
  if (img.close) img.close();              // libera o bitmap

  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return blob;
}

/** Blob -> endereço data:, usado quando não há Supabase. */
function paraDataURL(blob){
  return new Promise((ok, erro) => {
    const fr = new FileReader();
    fr.onload  = () => ok(fr.result);
    fr.onerror = () => erro(new Error('Não foi possível ler a imagem.'));
    fr.readAsDataURL(blob);
  });
}

/**
 * Reduz e envia. Devolve o endereço público da foto.
 * @param {File}   file       arquivo escolhido pelo usuário
 * @param {string} empresaId  pasta de destino
 * @param {string} materialId nome do arquivo
 */
export async function enviar(file, empresaId, materialId){
  if (!file) throw new Error('Nenhuma imagem escolhida.');
  if (!/^image\//.test(file.type))
    throw new Error('O arquivo escolhido não é uma imagem.');

  const blob = await reduzir(file);
  if (blob.size > LIMITE)
    throw new Error('A imagem ficou grande demais mesmo depois de reduzida.');

  if (!CONFIGURADO) return await paraDataURL(blob);   // modo demonstração

  const sb = await getClient();          // getClient e assincrona: sem await
  if (!sb) throw new Error('Sem conexão com o servidor.');
  const caminho = empresaId + '/' + materialId + '.jpg';
  const { error } = await sb.storage.from(BALDE).upload(caminho, blob, {
    upsert: true, contentType: 'image/jpeg', cacheControl: '3600'
  });
  if (error) throw new Error(traduzErro(error));

  const { data } = sb.storage.from(BALDE).getPublicUrl(caminho);
  /* O carimbo força o navegador a buscar de novo quando a foto é trocada:
     sem ele o endereço é idêntico ao anterior e o cache devolve a antiga. */
  return data.publicUrl + '?v=' + Date.now();
}

/**
 * Apaga a foto a partir do endereço guardado em materiais.foto_url.
 * Recebe o endereço, e não o id, porque o material pode ter sido criado com
 * uma chave de foto diferente do próprio id (material novo ainda não tem id
 * no momento em que a foto é escolhida).
 * Nunca estoura: foto que já sumiu não é problema.
 */
export async function removerPorUrl(url){
  if (!CONFIGURADO || !url || url.startsWith('data:')) return;
  try {
    const marca = '/' + BALDE + '/';
    const i = url.indexOf(marca);
    if (i < 0) return;
    const caminho = url.slice(i + marca.length).split('?')[0];
    if (!caminho) return;
    const sb = await getClient();
    if (!sb) return;
    await sb.storage.from(BALDE).remove([decodeURIComponent(caminho)]);
  } catch (e) { console.warn('[fotos] não deu para apagar o arquivo:', e); }
}

/** Chave nova para a foto de um material que ainda não foi salvo. */
export function novaChave(){
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** Tamanho legível, para mostrar ao usuário o quanto foi economizado. */
export function tamanhoLegivel(bytes){
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
