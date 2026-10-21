// Réseau social : personnes, amis, blocages, conversations (privées / groupes / communautés), messages, communautés, appels vidéo.
import { blocks, calls, communities, communityMembers, conversations, friendships, messages, users } from './db.js';

const MAX_TEXT = 2000;
const MAX_GROUP = 20;
const DAY = 86400000;

export function registerSocial({ app, requireAuth, ah, toId, escapeRe, isAdmin, realtime, sbRemove, sbPathOf, limiter }) {
  const S = String;
  const pairKey = (a, b) => [S(a), S(b)].sort().join(':');
  const cardOf = (u) => ({ id: S(u._id), name: u.name, avatar: u.avatar_url || null });
  const cardMap = async (ids) => new Map((await users.find({ _id: { $in: ids.map((i) => (typeof i === 'string' ? toId(i) : i)).filter(Boolean) } }).project({ name: 1, avatar_url: 1 }).toArray()).map((u) => [S(u._id), cardOf(u)]));
  const blockedEither = async (a, b) => !!(await blocks.findOne({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));
  const userExists = async (id) => !!(id && await users.findOne({ _id: id }, { projection: { _id: 1 } }));

  // limite par utilisateur (et non par adresse IP)
  const userLimit = (max, windowMs, message) => {
    const hits = new Map();
    setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some((t) => n - t < windowMs)) hits.delete(k); }, 60000).unref();
    return (req, res, next) => {
      const k = S(req.user._id), n = Date.now();
      const arr = (hits.get(k) || []).filter((t) => n - t < windowMs);
      if (arr.length >= max) return res.status(429).json({ error: message });
      arr.push(n); hits.set(k, arr); next();
    };
  };
  const msgLimit = userLimit(60, 60000, 'Tu envoies trop de messages. Patiente un instant.');
  const requestLimit = userLimit(30, 3600000, "Trop de demandes envoyées. Réessaie plus tard.");
  const createLimit = userLimit(20, 3600000, 'Trop de créations. Réessaie plus tard.');

  /* =============================== PERSONNES, AMIS, BLOCAGES =============================== */
  async function relations(me, ids) {
    const [fr, myBlocks] = await Promise.all([
      friendships.find({ pair: { $in: ids.map((i) => pairKey(me, i)) } }).toArray(),
      blocks.find({ blocker: me, blocked: { $in: ids } }).toArray(),
    ]);
    const byPair = new Map(fr.map((f) => [f.pair, f])), blocked = new Set(myBlocks.map((b) => S(b.blocked)));
    return (id) => {
      if (blocked.has(S(id))) return 'blocked';
      const f = byPair.get(pairKey(me, id));
      if (!f) return 'none';
      if (f.status === 'accepted') return 'friend';
      return S(f.requester) === S(me) ? 'sent' : 'received';
    };
  }

  app.get('/api/people', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const me = req.user._id, q = S(req.query.q ?? '').trim().slice(0, 40);
    const blockers = (await blocks.find({ blocked: me }).toArray()).map((b) => b.blocker);
    const filter = { _id: { $nin: [me, ...blockers] }, ...(q ? { name: new RegExp(escapeRe(q), 'i') } : {}) };
    const list = await users.find(filter).project({ name: 1, avatar_url: 1 }).sort({ created_at: -1 }).limit(30).toArray();
    const rel = await relations(me, list.map((u) => u._id));
    res.json({ people: list.map((u) => ({ ...cardOf(u), relation: rel(u._id) })) });
  }));

  app.get('/api/people/:id', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = toId(req.params.id), me = req.user._id;
    const u = id && await users.findOne({ _id: id }, { projection: { name: 1, avatar_url: 1 } });
    if (!u || S(id) === S(me) || await blocks.findOne({ blocker: id, blocked: me })) return res.status(404).json({ error: 'Personne introuvable.' });
    const rel = await relations(me, [id]);
    const commonIds = (await communityMembers.find({ user_id: id, status: 'active' }).toArray()).map((m) => m.community_id);
    const mine = new Set((await communityMembers.find({ user_id: me, status: 'active', community_id: { $in: commonIds } }).toArray()).map((m) => S(m.community_id)));
    res.json({ person: { ...cardOf(u), relation: rel(id), communitiesInCommon: mine.size } });
  }));

  app.get('/api/friends', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const me = req.user._id;
    const list = await friendships.find({ $or: [{ a: me }, { b: me }] }).sort({ created_at: -1 }).toArray();
    const other = (f) => (S(f.a) === S(me) ? f.b : f.a);
    const cards = await cardMap(list.map(other));
    const pick = (fn) => list.filter(fn).map((f) => cards.get(S(other(f)))).filter(Boolean);
    res.json({ friends: pick((f) => f.status === 'accepted'), received: pick((f) => f.status === 'pending' && S(f.requester) !== S(me)), sent: pick((f) => f.status === 'pending' && S(f.requester) === S(me)) });
  }));

  app.post('/api/friends/request', requireAuth, requestLimit, ah(async (req, res) => {
    const me = req.user._id, other = toId(req.body?.userId);
    if (!other || S(other) === S(me) || !(await userExists(other))) return res.status(404).json({ error: 'Personne introuvable.' });
    if (await blockedEither(me, other)) return res.status(403).json({ error: 'Impossible d\'envoyer une demande à cette personne.' });
    const pair = pairKey(me, other), existing = await friendships.findOne({ pair });
    if (existing?.status === 'accepted') return res.status(409).json({ error: 'Vous êtes déjà connectés.' });
    if (existing && S(existing.requester) !== S(me)) {                         // l'autre avait déjà demandé : on accepte
      await friendships.updateOne({ pair }, { $set: { status: 'accepted', accepted_at: Date.now() } });
      realtime.emitToUsers([other], { t: 'social' });
      return res.json({ relation: 'friend' });
    }
    if (!existing) await friendships.insertOne({ pair, a: me, b: other, requester: me, status: 'pending', created_at: Date.now() });
    realtime.emitToUsers([other], { t: 'social' });
    res.status(201).json({ relation: 'sent' });
  }));

  app.post('/api/friends/:userId/accept', requireAuth, ah(async (req, res) => {
    const me = req.user._id, other = toId(req.params.userId);
    const r = other && await friendships.updateOne({ pair: pairKey(me, other), status: 'pending', requester: other }, { $set: { status: 'accepted', accepted_at: Date.now() } });
    if (!r?.matchedCount) return res.status(404).json({ error: 'Demande introuvable.' });
    realtime.emitToUsers([other], { t: 'social' });
    res.json({ relation: 'friend' });
  }));

  // retirer un ami, refuser une demande reçue ou annuler une demande envoyée
  app.delete('/api/friends/:userId', requireAuth, ah(async (req, res) => {
    const me = req.user._id, other = toId(req.params.userId);
    if (other) { await friendships.deleteOne({ pair: pairKey(me, other) }); realtime.emitToUsers([other], { t: 'social' }); }
    res.json({ relation: 'none' });
  }));

  app.get('/api/blocks', requireAuth, ah(async (req, res) => {
    const list = await blocks.find({ blocker: req.user._id }).toArray();
    const cards = await cardMap(list.map((b) => b.blocked));
    res.json({ blocked: list.map((b) => cards.get(S(b.blocked))).filter(Boolean) });
  }));
  app.post('/api/blocks', requireAuth, ah(async (req, res) => {
    const me = req.user._id, other = toId(req.body?.userId);
    if (!other || S(other) === S(me) || !(await userExists(other))) return res.status(404).json({ error: 'Personne introuvable.' });
    await blocks.updateOne({ blocker: me, blocked: other }, { $setOnInsert: { created_at: Date.now() } }, { upsert: true });
    await friendships.deleteOne({ pair: pairKey(me, other) });
    res.json({ relation: 'blocked' });
  }));
  app.delete('/api/blocks/:userId', requireAuth, ah(async (req, res) => {
    const other = toId(req.params.userId);
    if (other) await blocks.deleteOne({ blocker: req.user._id, blocked: other });
    res.json({ relation: 'none' });
  }));

  /* =============================== CONVERSATIONS =============================== */
  const activeMembership = (communityId, uid) => communityMembers.findOne({ community_id: communityId, user_id: uid, status: 'active' });
  async function canAccess(conv, uid) {
    if (conv.type === 'community') return !!(await activeMembership(conv.community_id, uid));
    return (conv.members || []).some((m) => S(m) === S(uid));
  }
  async function memberIds(conv) {
    if (conv.type === 'community') return (await communityMembers.find({ community_id: conv.community_id, status: 'active' }).project({ user_id: 1 }).toArray()).map((m) => m.user_id);
    return conv.members || [];
  }
  const getConv = async (idStr) => { const id = toId(idStr); return id ? conversations.findOne({ _id: id }) : null; };

  async function convView(conv, me, cards, comm) {
    const base = { id: S(conv._id), type: conv.type, communityId: conv.community_id ? S(conv.community_id) : null };
    if (conv.type === 'direct') {
      const otherId = (conv.members || []).find((m) => S(m) !== S(me));
      const o = cards.get(S(otherId));
      return { ...base, name: o?.name ?? 'Utilisateur', avatar: o?.avatar ?? null, otherId: otherId ? S(otherId) : null, members: [] };
    }
    if (conv.type === 'community') return { ...base, name: comm?.name ?? 'Communauté', avatar: comm?.photo || null, members: [] };
    return { ...base, name: conv.name, avatar: conv.photo || null, createdBy: S(conv.created_by), members: (conv.members || []).map((m) => cards.get(S(m))).filter(Boolean) };
  }
  const lastOf = (conv, cards) => (conv.last_message
    ? { text: conv.last_message.type === 'call' ? '📹 Appel vidéo' : conv.last_message.text, at: conv.last_message_at, senderName: cards.get(S(conv.last_message.sender_id))?.name ?? '' }
    : null);

  app.get('/api/conversations', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const me = req.user._id;
    const myCommunities = (await communityMembers.find({ user_id: me, status: 'active' }).toArray()).map((m) => m.community_id);
    const list = await conversations.find({ $or: [{ members: me }, { community_id: { $in: myCommunities } }] }).sort({ last_message_at: -1, created_at: -1 }).limit(100).toArray();
    const shown = list.filter((c) => c.type !== 'direct' || c.last_message_at);
    const ids = new Set();
    for (const c of shown) { (c.members || []).forEach((m) => ids.add(S(m))); if (c.last_message) ids.add(S(c.last_message.sender_id)); }
    const [cards, comms] = await Promise.all([cardMap([...ids]), communities.find({ _id: { $in: shown.map((c) => c.community_id).filter(Boolean) } }).toArray()]);
    const commBy = new Map(comms.map((c) => [S(c._id), c]));
    const out = [];
    for (const c of shown) {
      const since = c.reads?.[S(me)] ?? 0;
      const unread = c.last_message_at && c.last_message_at > since ? await messages.countDocuments({ conversation_id: c._id, created_at: { $gt: since }, sender_id: { $ne: me } }, { limit: 100 }) : 0;
      out.push({ ...(await convView(c, me, cards, commBy.get(S(c.community_id)))), last: lastOf(c, cards), unread });
    }
    res.json({ conversations: out, unread: out.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0) });
  }));

  app.post('/api/conversations/direct', requireAuth, createLimit, ah(async (req, res) => {
    const me = req.user._id, other = toId(req.body?.userId);
    if (!other || S(other) === S(me) || !(await userExists(other))) return res.status(404).json({ error: 'Personne introuvable.' });
    if (await blockedEither(me, other)) return res.status(403).json({ error: 'Tu ne peux pas écrire à cette personne.' });
    const key = pairKey(me, other);
    const conv = await conversations.findOneAndUpdate({ direct_key: key }, { $setOnInsert: { type: 'direct', members: [me, other], direct_key: key, created_by: me, created_at: Date.now(), last_message_at: null, reads: {} } }, { upsert: true, returnDocument: 'after' });
    res.json({ id: S(conv._id) });
  }));

  async function friendsOnly(me, ids) {
    const fr = await friendships.find({ pair: { $in: ids.map((i) => pairKey(me, i)) }, status: 'accepted' }).toArray();
    return fr.length === ids.length;
  }

  app.post('/api/conversations/group', requireAuth, createLimit, ah(async (req, res) => {
    const me = req.user._id;
    const name = S(req.body?.name ?? '').trim();
    const ids = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(toId).filter(Boolean).map(S))].map(toId).filter((i) => S(i) !== S(me));
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Donne un nom au groupe (2 à 40 caractères).' });
    if (ids.length < 1 || ids.length > MAX_GROUP - 1) return res.status(400).json({ error: `Choisis entre 1 et ${MAX_GROUP - 1} personnes.` });
    if (!(await friendsOnly(me, ids))) return res.status(403).json({ error: 'Tu peux seulement ajouter des personnes avec qui tu es connecté.' });
    const photo = cleanPhoto(req.body?.photo);
    if (photo === null) return res.status(400).json({ error: 'Image invalide.' });
    const doc = { type: 'group', name, photo, members: [me, ...ids], created_by: me, created_at: Date.now(), last_message_at: null, reads: {} };
    doc._id = (await conversations.insertOne(doc)).insertedId;
    realtime.emitToUsers(ids, { t: 'social' });
    res.status(201).json({ id: S(doc._id) });
  }));

  app.get('/api/conversations/:id', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const conv = await getConv(req.params.id), me = req.user._id;
    if (!conv || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Conversation introuvable.' });
    const [cards, comm] = await Promise.all([cardMap((conv.members || []).map(S)), conv.community_id ? communities.findOne({ _id: conv.community_id }) : null]);
    const view = await convView(conv, me, cards, comm);
    if (conv.type === 'direct') {
      const o = view.otherId;
      view.blocked = !!(o && await blockedEither(me, toId(o)));
    }
    res.json({ conversation: view });
  }));

  const msgView = (m, cards, callsBy) => ({
    id: S(m._id), senderId: S(m.sender_id), sender: cards.get(S(m.sender_id)) ?? { id: S(m.sender_id), name: 'Utilisateur', avatar: null },
    type: m.type, text: m.text, createdAt: m.created_at,
    call: m.type === 'call' ? callsBy?.get(S(m.call_id)) ?? null : null,
  });
  const callView = (c) => ({ id: S(c._id), title: c.title, kind: c.kind, startsAt: c.starts_at, ended: !!c.ended_at });

  app.get('/api/conversations/:id/messages', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const conv = await getConv(req.params.id);
    if (!conv || !(await canAccess(conv, req.user._id))) return res.status(404).json({ error: 'Conversation introuvable.' });
    const before = Number(req.query.before);
    const rows = await messages.find({ conversation_id: conv._id, ...(Number.isFinite(before) ? { created_at: { $lt: before } } : {}) }).sort({ created_at: -1 }).limit(31).toArray();
    const page = rows.slice(0, 30).reverse();
    const [cards, callDocs] = await Promise.all([cardMap([...new Set(page.map((m) => S(m.sender_id)))]), calls.find({ _id: { $in: page.filter((m) => m.call_id).map((m) => m.call_id) } }).toArray()]);
    const callsBy = new Map(callDocs.map((c) => [S(c._id), callView(c)]));
    res.json({ messages: page.map((m) => msgView(m, cards, callsBy)), hasMore: rows.length > 30 });
  }));

  async function postMessage(conv, user, doc) {
    const now = Date.now();
    const m = { conversation_id: conv._id, sender_id: user._id, type: 'text', created_at: now, ...doc };
    m._id = (await messages.insertOne(m)).insertedId;
    await conversations.updateOne({ _id: conv._id }, { $set: { last_message_at: now, last_message: { text: m.text.slice(0, 120), type: m.type, sender_id: user._id }, ['reads.' + S(user._id)]: now } });
    const cards = new Map([[S(user._id), cardOf(user)]]);
    const callsBy = m.call_id ? new Map([[S(m.call_id), callView(await calls.findOne({ _id: m.call_id }))]]) : null;
    const view = msgView(m, cards, callsBy);
    realtime.emitToUsers(await memberIds(conv), { t: 'message', conversationId: S(conv._id), message: view });
    return view;
  }

  app.post('/api/conversations/:id/messages', requireAuth, msgLimit, ah(async (req, res) => {
    const conv = await getConv(req.params.id), me = req.user._id;
    if (!conv || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Conversation introuvable.' });
    const text = S(req.body?.text ?? '').trim();
    if (!text || text.length > MAX_TEXT) return res.status(400).json({ error: `Écris un message (${MAX_TEXT} caractères maximum).` });
    if (conv.type === 'direct') {
      const o = conv.members.find((x) => S(x) !== S(me));
      if (!o || await blockedEither(me, o)) return res.status(403).json({ error: 'Tu ne peux plus écrire à cette personne.' });
    }
    res.status(201).json({ message: await postMessage(conv, req.user, { text }) });
  }));

  app.post('/api/conversations/:id/read', requireAuth, ah(async (req, res) => {
    const conv = await getConv(req.params.id);
    if (conv && await canAccess(conv, req.user._id)) await conversations.updateOne({ _id: conv._id }, { $set: { ['reads.' + S(req.user._id)]: Date.now() } });
    res.json({ ok: true });
  }));

  app.put('/api/conversations/:id', requireAuth, ah(async (req, res) => {
    const conv = await getConv(req.params.id), me = req.user._id;
    if (!conv || conv.type !== 'group' || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Groupe introuvable.' });
    if (S(conv.created_by) !== S(me)) return res.status(403).json({ error: 'Seul le créateur du groupe peut le modifier.' });
    const name = S(req.body?.name ?? conv.name).trim(), photo = cleanPhoto(req.body?.photo ?? conv.photo ?? '');
    if (name.length < 2 || name.length > 40 || photo === null) return res.status(400).json({ error: 'Informations invalides.' });
    if (conv.photo && conv.photo !== photo) await sbRemove(sbPathOf(conv.photo));            // l'ancienne icône est supprimée du stockage
    await conversations.updateOne({ _id: conv._id }, { $set: { name, photo } });
    res.json({ ok: true });
  }));

  app.post('/api/conversations/:id/members', requireAuth, ah(async (req, res) => {
    const conv = await getConv(req.params.id), me = req.user._id, other = toId(req.body?.userId);
    if (!conv || conv.type !== 'group' || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Groupe introuvable.' });
    if (!other || !(await userExists(other))) return res.status(404).json({ error: 'Personne introuvable.' });
    if (conv.members.length >= MAX_GROUP) return res.status(409).json({ error: `Un groupe contient ${MAX_GROUP} personnes au maximum.` });
    if (!(await friendsOnly(me, [other])) || await blockedEither(me, other)) return res.status(403).json({ error: 'Tu peux seulement ajouter des personnes avec qui tu es connecté.' });
    await conversations.updateOne({ _id: conv._id }, { $addToSet: { members: other } });
    realtime.emitToUsers([other], { t: 'social' });
    res.json({ ok: true });
  }));

  app.post('/api/conversations/:id/leave', requireAuth, ah(async (req, res) => {
    const conv = await getConv(req.params.id), me = req.user._id;
    if (!conv || conv.type !== 'group' || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Groupe introuvable.' });
    await conversations.updateOne({ _id: conv._id }, { $pull: { members: me } });
    if (conv.members.length <= 1) await Promise.all([conversations.deleteOne({ _id: conv._id }), messages.deleteMany({ conversation_id: conv._id }), calls.deleteMany({ conversation_id: conv._id }), sbRemove(sbPathOf(conv.photo))]);
    res.json({ ok: true });
  }));

  /* =============================== COMMUNAUTÉS =============================== */
  const ROLE_RANK = { owner: 3, admin: 2, member: 1 };
  const isManager = (m) => m && m.status === 'active' && ROLE_RANK[m.role] >= 2;
  const commJson = (c, count, extra = {}) => ({ id: S(c._id), name: c.name, description: c.description, photo: c.photo || null, visibility: c.visibility, members: count, ownerId: S(c.owner_id), ...extra });
  const countMembers = async (ids) => new Map((await communityMembers.aggregate([{ $match: { community_id: { $in: ids }, status: 'active' } }, { $group: { _id: '$community_id', n: { $sum: 1 } } }]).toArray()).map((r) => [S(r._id), r.n]));
  const cleanPhoto = (p) => { const s = S(p ?? '').trim(); return !s ? '' : sbPathOf(s) !== null ? s : null; };   // seulement une image de notre stockage

  app.post('/api/communities', requireAuth, createLimit, ah(async (req, res) => {
    const me = req.user._id, b = req.body ?? {};
    const name = S(b.name ?? '').trim(), description = S(b.description ?? '').trim();
    if (name.length < 3 || name.length > 50) return res.status(400).json({ error: 'Donne un nom à ta communauté (3 à 50 caractères).' });
    if (description.length > 300) return res.status(400).json({ error: 'La description doit faire 300 caractères au maximum.' });
    if (!['public', 'private'].includes(b.visibility)) return res.status(400).json({ error: 'Choisis public ou privé.' });
    const photo = cleanPhoto(b.photo);
    if (photo === null) return res.status(400).json({ error: 'Image invalide.' });
    if (await communities.countDocuments({ owner_id: me }) >= 10) return res.status(409).json({ error: 'Tu peux créer 10 communautés au maximum.' });
    const now = Date.now();
    const doc = { name, description, photo, visibility: b.visibility, owner_id: me, created_at: now };
    doc._id = (await communities.insertOne(doc)).insertedId;
    await communityMembers.insertOne({ community_id: doc._id, user_id: me, role: 'owner', status: 'active', joined_at: now });
    await conversations.insertOne({ type: 'community', community_id: doc._id, created_by: me, created_at: now, last_message_at: null, reads: {} });
    res.status(201).json({ id: S(doc._id) });
  }));

  app.get('/api/communities', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const me = req.user._id, q = S(req.query.q ?? '').trim().slice(0, 40);
    const mem = await communityMembers.find({ user_id: me }).toArray();
    const mine = new Map(mem.map((m) => [S(m.community_id), m]));
    const ids = mem.map((m) => m.community_id);
    const [myDocs, discover] = await Promise.all([
      communities.find({ _id: { $in: ids } }).toArray(),
      communities.find({ visibility: 'public', _id: { $nin: ids }, ...(q ? { name: new RegExp(escapeRe(q), 'i') } : {}) }).sort({ created_at: -1 }).limit(30).toArray(),
    ]);
    const counts = await countMembers([...ids, ...discover.map((c) => c._id)]);
    const view = (c) => { const m = mine.get(S(c._id)); return commJson(c, counts.get(S(c._id)) ?? 0, { status: m?.status ?? null, role: m?.role ?? null }); };
    res.json({
      mine: myDocs.filter((c) => mine.get(S(c._id))?.status === 'active').map(view),
      invitations: myDocs.filter((c) => mine.get(S(c._id))?.status === 'invited').map(view),
      discover: discover.map(view),
    });
  }));

  async function loadCommunity(req) {
    const id = toId(req.params.id);
    const c = id && await communities.findOne({ _id: id });
    if (!c) return {};
    const m = await communityMembers.findOne({ community_id: c._id, user_id: req.user._id });
    const visible = c.visibility === 'public' || m || isAdmin(req.user);
    return visible ? { c, m } : {};
  }

  app.get('/api/communities/:id', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { c, m } = await loadCommunity(req);
    if (!c) return res.status(404).json({ error: 'Communauté introuvable.' });
    const [memRows, count, conv, lives] = await Promise.all([
      communityMembers.find({ community_id: c._id, status: 'active' }).sort({ joined_at: 1 }).limit(60).toArray(),
      communityMembers.countDocuments({ community_id: c._id, status: 'active' }),
      conversations.findOne({ community_id: c._id }, { projection: { _id: 1 } }),
      calls.find({ community_id: c._id, ended_at: null, starts_at: { $gt: Date.now() - 6 * 3600000 } }).sort({ starts_at: 1 }).limit(20).toArray(),
    ]);
    const cards = await cardMap(memRows.map((r) => r.user_id));
    const active = m?.status === 'active';
    res.json({
      community: commJson(c, count, { status: m?.status ?? null, role: m?.role ?? null }),
      canManage: isManager(m) || isAdmin(req.user), canDelete: m?.role === 'owner' || isAdmin(req.user),
      conversationId: active && conv ? S(conv._id) : null,
      members: memRows.map((r) => ({ ...(cards.get(S(r.user_id)) ?? { id: S(r.user_id), name: 'Utilisateur', avatar: null }), role: r.role })),
      lives: active ? lives.map((l) => ({ ...callView(l), live: l.starts_at <= Date.now() + 600000 })) : [],
    });
  }));

  app.post('/api/communities/:id/join', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req), me = req.user._id;
    if (!c) return res.status(404).json({ error: 'Communauté introuvable.' });
    if (m?.status === 'active') return res.json({ ok: true });
    if (c.visibility === 'private' && m?.status !== 'invited') return res.status(403).json({ error: 'Cette communauté est privée : il faut une invitation.' });
    await communityMembers.updateOne({ community_id: c._id, user_id: me }, { $set: { status: 'active', joined_at: Date.now() }, $setOnInsert: { role: 'member' } }, { upsert: true });
    res.json({ ok: true });
  }));

  app.post('/api/communities/:id/leave', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req);
    if (!c || !m) return res.status(404).json({ error: 'Communauté introuvable.' });
    if (m.role === 'owner') return res.status(409).json({ error: 'Le créateur ne peut pas quitter : supprime la communauté à la place.' });
    await communityMembers.deleteOne({ community_id: c._id, user_id: req.user._id });
    res.json({ ok: true });
  }));

  app.post('/api/communities/:id/invite', requireAuth, requestLimit, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req), other = toId(req.body?.userId);
    if (!c || !isManager(m)) return res.status(403).json({ error: 'Seuls les administrateurs de la communauté peuvent inviter.' });
    if (!other || !(await userExists(other))) return res.status(404).json({ error: 'Personne introuvable.' });
    if (await blockedEither(req.user._id, other)) return res.status(403).json({ error: 'Impossible d\'inviter cette personne.' });
    await communityMembers.updateOne({ community_id: c._id, user_id: other }, { $setOnInsert: { role: 'member', status: 'invited', joined_at: Date.now(), invited_by: req.user._id } }, { upsert: true });
    realtime.emitToUsers([other], { t: 'social' });
    res.json({ ok: true });
  }));

  app.post('/api/communities/:id/accept', requireAuth, ah(async (req, res) => {
    const id = toId(req.params.id);
    const r = id && await communityMembers.updateOne({ community_id: id, user_id: req.user._id, status: 'invited' }, { $set: { status: 'active', joined_at: Date.now() } });
    if (!r?.matchedCount) return res.status(404).json({ error: 'Invitation introuvable.' });
    res.json({ ok: true });
  }));
  app.delete('/api/communities/:id/invitation', requireAuth, ah(async (req, res) => {
    const id = toId(req.params.id);
    if (id) await communityMembers.deleteOne({ community_id: id, user_id: req.user._id, status: 'invited' });
    res.json({ ok: true });
  }));

  app.delete('/api/communities/:id/members/:userId', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req), other = toId(req.params.userId);
    if (!c || !other) return res.status(404).json({ error: 'Communauté introuvable.' });
    const target = await communityMembers.findOne({ community_id: c._id, user_id: other });
    if (!target) return res.json({ ok: true });
    if (!(isManager(m) || isAdmin(req.user)) || target.role === 'owner' || (m?.role === 'admin' && target.role === 'admin' && !isAdmin(req.user))) return res.status(403).json({ error: "Tu n'as pas le droit de retirer cette personne." });
    await communityMembers.deleteOne({ community_id: c._id, user_id: other });
    res.json({ ok: true });
  }));

  app.put('/api/communities/:id/members/:userId', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req), other = toId(req.params.userId), role = req.body?.role;
    if (!c || m?.role !== 'owner' || !['admin', 'member'].includes(role) || !other) return res.status(403).json({ error: 'Seul le créateur peut changer les rôles.' });
    const r = await communityMembers.updateOne({ community_id: c._id, user_id: other, status: 'active', role: { $ne: 'owner' } }, { $set: { role } });
    if (!r.matchedCount) return res.status(404).json({ error: 'Membre introuvable.' });
    res.json({ ok: true });
  }));

  app.put('/api/communities/:id', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req), b = req.body ?? {};
    if (!c || m?.role !== 'owner') return res.status(403).json({ error: 'Seul le créateur peut modifier la communauté.' });
    const name = S(b.name ?? '').trim(), description = S(b.description ?? '').trim(), photo = cleanPhoto(b.photo);
    if (name.length < 3 || name.length > 50 || description.length > 300 || !['public', 'private'].includes(b.visibility) || photo === null) return res.status(400).json({ error: 'Informations invalides.' });
    if (c.photo && c.photo !== photo) await sbRemove(sbPathOf(c.photo));
    await communities.updateOne({ _id: c._id }, { $set: { name, description, visibility: b.visibility, photo } });
    res.json({ ok: true });
  }));

  async function purgeCommunity(c) {
    const convs = await conversations.find({ community_id: c._id }).project({ _id: 1 }).toArray();
    const callDocs = await calls.find({ community_id: c._id }).project({ _id: 1 }).toArray();
    callDocs.forEach((x) => realtime.endRoom(x._id));
    await Promise.all([
      messages.deleteMany({ conversation_id: { $in: convs.map((x) => x._id) } }), conversations.deleteMany({ community_id: c._id }),
      calls.deleteMany({ community_id: c._id }), communityMembers.deleteMany({ community_id: c._id }), communities.deleteOne({ _id: c._id }), sbRemove(sbPathOf(c.photo)),
    ]);
  }
  app.delete('/api/communities/:id', requireAuth, ah(async (req, res) => {
    const { c, m } = await loadCommunity(req);
    if (!c) return res.json({ ok: true });
    if (m?.role !== 'owner' && !isAdmin(req.user)) return res.status(403).json({ error: 'Seul le créateur peut supprimer la communauté.' });
    await purgeCommunity(c);
    res.json({ ok: true });
  }));

  /* =============================== APPELS VIDÉO ET LIVES =============================== */
  const iceServers = () => { try { const j = JSON.parse(process.env.ICE_SERVERS || ''); if (Array.isArray(j)) return j; } catch { /* valeur par défaut */ } return [{ urls: 'stun:stun.l.google.com:19302' }]; };
  const MAX_CALL_AGE = 12 * 3600000;

  // un appel est rejoignable de 10 min avant son début jusqu'à sa fin (ou 12 h après)
  const callState = (c, now = Date.now()) => (c.ended_at || now > c.starts_at + MAX_CALL_AGE ? 'ended' : now < c.starts_at - 600000 ? 'scheduled' : 'live');

  async function callAccess(callIdStr, uid) {
    const id = toId(callIdStr);
    const call = id && await calls.findOne({ _id: id });
    if (!call) return {};
    const conv = await conversations.findOne({ _id: call.conversation_id });
    if (!conv || !(await canAccess(conv, uid))) return {};
    return { call, conv };
  }

  app.post('/api/conversations/:id/calls', requireAuth, createLimit, ah(async (req, res) => {
    const conv = await getConv(req.params.id), me = req.user._id, b = req.body ?? {};
    if (!conv || !(await canAccess(conv, me))) return res.status(404).json({ error: 'Conversation introuvable.' });
    const kind = b.kind === 'live' ? 'live' : 'call';
    const now = Date.now();
    const title = S(b.title ?? '').trim().slice(0, 80) || (kind === 'live' ? 'Live' : 'Appel vidéo');
    let startsAt = now;
    if (kind === 'live') {
      startsAt = Number(b.startsAt);
      if (!Number.isFinite(startsAt) || startsAt < now - 300000 || startsAt > now + 90 * DAY) return res.status(400).json({ error: 'Choisis une date de live dans les 90 prochains jours.' });
      if (conv.type === 'community') {
        const m = await activeMembership(conv.community_id, me);
        if (!isManager(m)) return res.status(403).json({ error: 'Seuls les administrateurs de la communauté peuvent programmer un live.' });
      }
    }
    if (conv.type === 'direct') {
      const o = conv.members.find((x) => S(x) !== S(me));
      if (!o || await blockedEither(me, o)) return res.status(403).json({ error: 'Tu ne peux plus appeler cette personne.' });
    }
    const doc = { conversation_id: conv._id, community_id: conv.community_id ?? null, host_id: me, title, kind, starts_at: Math.round(startsAt), created_at: now, ended_at: null };
    doc._id = (await calls.insertOne(doc)).insertedId;
    await postMessage(conv, req.user, { type: 'call', call_id: doc._id, text: kind === 'live' ? `Live programmé : ${title}` : `Appel vidéo : ${title}` });
    res.status(201).json({ call: callView(doc) });
  }));

  app.get('/api/calls/:id', requireAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { call, conv } = await callAccess(req.params.id, req.user._id);
    if (!call) return res.status(404).json({ error: 'Appel introuvable.' });
    const host = (await cardMap([call.host_id])).get(S(call.host_id));
    let canEnd = S(call.host_id) === S(req.user._id) || isAdmin(req.user);
    if (!canEnd && conv.type === 'community') canEnd = isManager(await activeMembership(conv.community_id, req.user._id));
    res.json({ call: { ...callView(call), state: callState(call), host, conversationId: S(conv._id), canEnd, participants: realtime.roomUsers(call._id).length }, iceServers: iceServers() });
  }));

  app.post('/api/calls/:id/end', requireAuth, ah(async (req, res) => {
    const { call, conv } = await callAccess(req.params.id, req.user._id);
    if (!call) return res.status(404).json({ error: 'Appel introuvable.' });
    let ok = S(call.host_id) === S(req.user._id) || isAdmin(req.user);
    if (!ok && conv.type === 'community') ok = isManager(await activeMembership(conv.community_id, req.user._id));
    if (!ok) return res.status(403).json({ error: "Seul l'organisateur peut terminer cet appel." });
    await calls.updateOne({ _id: call._id }, { $set: { ended_at: Date.now() } });
    realtime.endRoom(call._id);
    res.json({ ok: true });
  }));

  // utilisé par le WebSocket avant d'accepter quelqu'un dans la salle
  async function canJoinCall(uid, callIdStr) {
    const { call } = await callAccess(callIdStr, toId(uid));
    if (!call) return { ok: false, reason: 'not_found' };
    const st = callState(call);
    if (st === 'ended') return { ok: false, reason: 'ended' };
    if (st === 'scheduled') return { ok: false, reason: 'not_started' };
    return { ok: true };
  }

  return { canJoinCall, cardMap, purgeUserSocial };

  // appelée à la suppression d'un compte : retire toutes les traces sociales de l'utilisateur
  async function purgeUserSocial(uid) {
    const owned = await communities.find({ owner_id: uid }).toArray();
    for (const c of owned) await purgeCommunity(c);
    await Promise.all([
      friendships.deleteMany({ $or: [{ a: uid }, { b: uid }] }), blocks.deleteMany({ $or: [{ blocker: uid }, { blocked: uid }] }),
      communityMembers.deleteMany({ user_id: uid }), messages.deleteMany({ sender_id: uid }),
    ]);
    const mine = await conversations.find({ members: uid }).toArray();
    await calls.deleteMany({ host_id: uid });
    for (const conv of mine) {
      if (conv.type === 'direct' || conv.members.length <= 2) await Promise.all([conversations.deleteOne({ _id: conv._id }), messages.deleteMany({ conversation_id: conv._id }), calls.deleteMany({ conversation_id: conv._id }), sbRemove(sbPathOf(conv.photo))]);
      else await conversations.updateOne({ _id: conv._id }, { $pull: { members: uid } });
    }
  }
}
