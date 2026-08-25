/* GET /api/shelf/<id>.3mf — the slicer's side of the hand-off. 404 after the
 * ten minutes, and immutable within them (the id never carries a second file). */
export async function onRequestGet({ params, env }) {
  if (!env.SHELF) return new Response('shelf not configured', { status: 503 });
  const id = String(params.name || '').replace(/\.3mf$/, '');
  if (!/^[0-9a-f]{32}$/.test(id)) return new Response('not found', { status: 404 });
  const bytes = await env.SHELF.get('m:' + id, 'arrayBuffer');
  if (!bytes) return new Response('gone', { status: 404 });
  return new Response(bytes, { headers: {
    'Content-Type': 'model/3mf',
    'Content-Disposition': 'attachment; filename="freyacad.3mf"',
    'Cache-Control': 'no-store'
  }});
}
