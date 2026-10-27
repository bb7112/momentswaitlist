/* Moments admin dashboard. Only accounts listed in public.admins can read or change anything here
   (enforced by the database rules in supabase/10-admin.sql, not by this page). */
(function () {
  'use strict';

  var cfg = window.MOMENTS_CONFIG;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  var VIBES = ['wellness', 'pop-up', 'rooftop', 'creative', 'book', 'faith', 'career'];
  var COMM_COLS = 'id, slug, name, bio, cover_url, avatar_url, instagram, website, position, is_private, host_id, host_name, base_members, is_sample, created_at';
  var main = document.getElementById('main');
  var me = null, people = {}, openReports = 0;

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || main).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || main).querySelectorAll(s)); }
  function toast(m) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function day(d) { return new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function time(d) { return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function ago(d) {
    var s = (Date.now() - new Date(d)) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function weekAgo() { return new Date(Date.now() - 7 * 86400000).toISOString(); }
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
  // datetime-local <-> ISO in the viewer's timezone (Miami)
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
  async function count(q) { var r = await q; return r.error ? '–' : (r.count || 0); }
  function photoOf(p) { return p && p.photos && p.photos[0] ? p.photos[0] : ''; }
  async function loadPeople(ids) {
    var need = ids.filter(function (id) { return id && !people[id]; });
    if (!need.length) return;
    var r = await sb.from('profiles').select('*').in('id', need);
    (r.data || []).forEach(function (p) { people[p.id] = p; });
  }
  async function uploadImage(file) {
    var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(file); });
    var s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
    var path = me.id + '/admin/' + Date.now() + '.jpg';
    var up = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }
  // an image field = url box + upload button + preview
  function imageField(name, label, val) {
    return '<label class="full">' + label + '<input name="' + name + '" value="' + esc(val || '') + '" placeholder="paste an image link or upload">' +
      '<input type="file" accept="image/*" data-upload="' + name + '" style="border:0;padding:4px 0">' +
      (val ? '<img class="preview" src="' + esc(val) + '" alt="">' : '') + '</label>';
  }
  function bindUploads(form) {
    $$('[data-upload]', form).forEach(function (inp) {
      inp.onchange = async function () {
        var f = inp.files[0]; if (!f) return;
        var target = form.elements[inp.dataset.upload];
        target.value = 'uploading…';
        try { target.value = await uploadImage(f); toast('photo uploaded'); }
        catch (e) { target.value = ''; toast('upload failed: ' + (e.message || e)); }
      };
    });
  }

  // ---------- shell ----------
  var TABS = [['overview', 'Overview'], ['events', 'Events'], ['communities', 'Communities'], ['people', 'People'], ['reports', 'Reports']];
  function drawTabs(cur) {
    document.getElementById('tabs').innerHTML = TABS.map(function (t) {
      return '<a href="#' + t[0] + '" class="' + (t[0] === cur ? 'on' : '') + '">' + t[1] + (t[0] === 'reports' && openReports ? '<span class="count">' + openReports + '</span>' : '') + '</a>';
    }).join('');
  }
  async function route() {
    var h = (location.hash.replace(/^#/, '') || 'overview').split('/');
    drawTabs(h[0]);
    main.innerHTML = '<p class="empty">Loading…</p>';
    window.scrollTo(0, 0);
    try {
      if (h[0] === 'events') return h[1] ? eventForm(h[1]) : viewEvents();
      if (h[0] === 'communities') return h[1] ? communityForm(h[1]) : viewCommunities();
      if (h[0] === 'people') return viewPeople();
      if (h[0] === 'reports') return viewReports();
      return viewOverview();
    } catch (e) { main.innerHTML = '<p class="empty">Something went wrong: ' + esc(e.message || e) + '</p>'; }
  }

  // ---------- overview ----------
  async function viewOverview() {
    var wk = weekAgo();
    var nums = await Promise.all([
      count(sb.from('profiles').select('id', { count: 'exact', head: true })),
      count(sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', wk)),
      count(sb.from('notes').select('id', { count: 'exact', head: true }).gte('created_at', wk)),
      count(sb.from('note_members').select('note_id', { count: 'exact', head: true }).gte('joined_at', wk)),
      count(sb.from('community_members').select('user_id', { count: 'exact', head: true }).eq('status', 'member')),
      count(sb.from('ticket_clicks').select('id', { count: 'exact', head: true }).gte('created_at', wk)),
      count(sb.from('event_saves').select('event_id', { count: 'exact', head: true })),
      count(sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'))
    ]);
    var tr = await sb.from('ticket_report').select('*').limit(8);
    var pend = await sb.from('community_members').select('community_id, user_id, request_note, created_at').eq('status', 'requested').order('created_at', { ascending: false }).limit(20);
    var labels = ['members', 'new members this week', 'notes this week', 'plan joins this week', 'community members', 'ticket taps this week', 'event saves', 'open reports'];
    main.innerHTML = '<h1>Overview</h1><p class="sub">How Moments is doing. Numbers update when you open this tab.</p>' +
      '<div class="stats">' + nums.map(function (n, i) { return '<div class="stat"><b>' + n + '</b><span>' + labels[i] + '</span></div>'; }).join('') + '</div>' +
      '<h2>Events by "Get tickets" taps</h2><div class="card">' + ((tr.data || []).length ? tr.data.map(function (e) {
        return '<div class="row"><div class="grow"><b>' + esc(e.title) + '</b><span class="muted">' + esc(e.event_date || '') + (e.ticket_source ? ' · ' + esc(e.ticket_source) : '') + '</span></div>' +
          '<span class="pill">' + e.people + ' people</span><span class="pill">' + e.taps + ' taps</span><span class="pill">' + e.saves + ' saves</span></div>';
      }).join('') : '<p class="empty">No ticket taps yet.</p>') + '</div>' +
      ((pend.data || []).length ? '<h2>Waiting to join a private community</h2><div class="card" id="pending"></div>' : '');
    if ((pend.data || []).length) await drawPending(pend.data);
  }
  async function drawPending(rows) {
    await loadPeople(rows.map(function (r) { return r.user_id; }));
    var cr = await sb.from('communities').select('id, name');
    var names = {}; (cr.data || []).forEach(function (c) { names[c.id] = c.name; });
    $('#pending').innerHTML = rows.map(function (r) {
      var p = people[r.user_id] || {};
      return '<div class="row"><img class="av" src="' + esc(photoOf(p)) + '" alt=""><div class="grow"><b>' + esc(p.first_name || 'someone') + ' → ' + esc(names[r.community_id] || '') + '</b><span class="muted">' + esc(r.request_note || 'no note') + ' · ' + ago(r.created_at) + '</span></div>' +
        '<div class="actions"><button class="dark" data-approve="' + r.community_id + '|' + r.user_id + '">Let in</button><button data-decline="' + r.community_id + '|' + r.user_id + '">Decline</button></div></div>';
    }).join('');
    $$('[data-approve]').forEach(function (b) {
      b.onclick = async function () {
        var k = b.dataset.approve.split('|');
        var r = await sb.from('community_members').update({ status: 'member' }).eq('community_id', k[0]).eq('user_id', k[1]);
        toast(r.error ? 'Couldn\'t approve: ' + r.error.message : 'let in'); route();
      };
    });
    $$('[data-decline]').forEach(function (b) {
      b.onclick = async function () {
        var k = b.dataset.decline.split('|');
        var r = await sb.from('community_members').delete().eq('community_id', k[0]).eq('user_id', k[1]);
        toast(r.error ? 'Couldn\'t decline: ' + r.error.message : 'declined'); route();
      };
    });
  }

  // ---------- events ----------
  async function viewEvents() {
    var r = await sb.from('events').select('*').order('starts_at', { ascending: false }).limit(200);
    var all = r.data || [], now = Date.now();
    var up = all.filter(function (e) { return new Date(e.starts_at) >= now; }).reverse();
    var past = all.filter(function (e) { return new Date(e.starts_at) < now; });
    function rowOf(e) {
      return '<div class="row"><img class="th" src="' + esc(e.image_url) + '" alt=""><div class="grow"><b>' + esc(e.title) + '</b>' +
        '<span class="muted">' + day(e.starts_at) + ' · ' + time(e.starts_at) + ' · ' + esc(e.neighborhood || '') + ' · ' + esc(e.price_label) + ' · by ' + esc(e.posted_by) + '</span>' +
        '<span>' + (e.featured ? '<span class="pill wine">featured</span> ' : '') + (e.is_sample ? '<span class="pill">sample</span> ' : '') + '<span class="pill">' + esc(e.vibe) + '</span></span></div>' +
        '<div class="actions"><a class="btn" href="#events/' + e.id + '">Edit</a><button data-feat="' + e.id + '|' + (e.featured ? 0 : 1) + '">' + (e.featured ? 'Unfeature' : 'Feature') + '</button><button class="danger" data-del="' + e.id + '">Delete</button></div></div>';
    }
    main.innerHTML = '<div class="toolbar"><h1 style="flex:1;margin:0">Events</h1><a class="btn dark" href="#events/new">+ Add event</a></div>' +
      '<p class="sub">Everything in Discover. Featured events show at the top.</p>' +
      '<h2>Coming up (' + up.length + ')</h2><div class="card">' + (up.length ? up.map(rowOf).join('') : '<p class="empty">No upcoming events.</p>') + '</div>' +
      '<h2>Past (' + past.length + ')</h2><div class="card">' + (past.length ? past.map(rowOf).join('') : '<p class="empty">None yet.</p>') + '</div>';
    $$('[data-feat]').forEach(function (b) {
      b.onclick = async function () {
        var k = b.dataset.feat.split('|');
        var x = await sb.from('events').update({ featured: k[1] === '1' }).eq('id', k[0]);
        toast(x.error ? x.error.message : 'saved'); route();
      };
    });
    $$('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Delete this event? This can\'t be undone.')) return;
        var x = await sb.from('events').delete().eq('id', b.dataset.del);
        toast(x.error ? x.error.message : 'deleted'); route();
      };
    });
  }
  async function eventForm(id) {
    var e = { vibe: 'wellness', price_label: 'Free', posted_by: 'Moments', featured: false };
    if (id !== 'new') { var r = await sb.from('events').select('*').eq('id', id).maybeSingle(); if (!r.data) { main.innerHTML = '<p class="empty">Event not found.</p>'; return; } e = r.data; }
    var cr = await sb.from('communities').select('id, name, host_name').order('name');
    var comms = cr.data || [];
    main.innerHTML = '<div class="toolbar"><a class="btn" href="#events">← Events</a><h1 style="margin:0">' + (id === 'new' ? 'Add event' : 'Edit event') + '</h1></div>' +
      '<div class="card"><form class="grid" id="f">' +
      '<label class="full">Title<input name="title" required maxlength="120" value="' + esc(e.title || '') + '"></label>' +
      '<label>Vibe<select name="vibe">' + VIBES.map(function (v) { return '<option' + (v === e.vibe ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
      '<label>Posted by (shown on the event)<input name="posted_by" required value="' + esc(e.posted_by || '') + '"></label>' +
      '<label class="full">Description<textarea name="description" maxlength="1000">' + esc(e.description || '') + '</textarea></label>' +
      '<label>Starts<input type="datetime-local" name="starts_at" required value="' + toLocalInput(e.starts_at) + '"></label>' +
      '<label>Ends<input type="datetime-local" name="ends_at" value="' + toLocalInput(e.ends_at) + '"></label>' +
      '<label>Neighborhood<input name="neighborhood" value="' + esc(e.neighborhood || '') + '" placeholder="Wynwood"></label>' +
      '<label>Address or note<input name="address" value="' + esc(e.address || '') + '" placeholder="address sent after you get tickets"></label>' +
      '<label>Price<input name="price_label" required value="' + esc(e.price_label || '') + '" placeholder="Free, $35"></label>' +
      '<label>Community (optional)<select name="community_id"><option value="">none</option>' + comms.map(function (c) { return '<option value="' + c.id + '"' + (c.id === e.community_id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Ticket link<input name="ticket_url" type="url" value="' + esc(e.ticket_url || '') + '" placeholder="https://partiful.com/e/..."></label>' +
      '<label>Ticket site name<input name="ticket_source" value="' + esc(e.ticket_source || '') + '" placeholder="Partiful, Eventbrite, Luma"></label>' +
      imageField('image_url', 'Photo', e.image_url) +
      '<label class="check full"><input type="checkbox" name="featured"' + (e.featured ? ' checked' : '') + '> Featured in Discover</label>' +
      '</form><div class="formfoot"><a class="btn" href="#events">Cancel</a><button class="dark" id="save">Save event</button></div></div>';
    var f = $('#f'); bindUploads(f);
    $('#save').onclick = async function () {
      if (!f.reportValidity()) return;
      var v = f.elements, row = {
        title: v.title.value.trim(), vibe: v.vibe.value, posted_by: v.posted_by.value.trim(), description: v.description.value.trim() || null,
        starts_at: fromLocalInput(v.starts_at.value), ends_at: fromLocalInput(v.ends_at.value), neighborhood: v.neighborhood.value.trim() || null,
        address: v.address.value.trim() || null, price_label: v.price_label.value.trim(), community_id: v.community_id.value || null,
        ticket_url: v.ticket_url.value.trim() || null, ticket_source: v.ticket_source.value.trim() || null,
        image_url: v.image_url.value.trim() || null, featured: v.featured.checked, is_sample: false
      };
      this.disabled = true;
      var x = id === 'new' ? await sb.from('events').insert(row) : await sb.from('events').update(row).eq('id', id);
      if (x.error) { this.disabled = false; toast('Couldn\'t save: ' + x.error.message); return; }
      toast('event saved'); location.hash = '#events';
    };
  }

  // ---------- communities ----------
  async function viewCommunities() {
    var cr = await sb.from('communities').select(COMM_COLS);
    var mr = await sb.from('community_members').select('community_id, status');
    var pr = await sb.from('community_pitches').select('*').order('created_at', { ascending: false }).limit(30);
    var list = (cr.data || []).sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position) || b.base_members - a.base_members; });
    var mem = {}, req = {};
    (mr.data || []).forEach(function (m) { if (m.status === 'member') mem[m.community_id] = (mem[m.community_id] || 0) + 1; else req[m.community_id] = (req[m.community_id] || 0) + 1; });
    await loadPeople((pr.data || []).map(function (p) { return p.user_id; }));
    main.innerHTML = '<div class="toolbar"><h1 style="flex:1;margin:0">Communities</h1><a class="btn dark" href="#communities/new">+ New community</a></div>' +
      '<p class="sub">Pinned communities (with a position number) show first in the app, lowest number on top.</p>' +
      '<div class="card">' + (list.length ? list.map(function (c) {
        return '<div class="row"><img class="th" src="' + esc(c.avatar_url || c.cover_url) + '" alt=""><div class="grow"><b>' + esc(c.name) + '</b>' +
          '<span class="muted">Hosted by ' + esc(c.host_name) + ' · ' + (mem[c.id] || 0) + ' real members' + (c.base_members ? ' (+' + c.base_members + ' shown)' : '') + (req[c.id] ? ' · ' + req[c.id] + ' waiting' : '') + '</span>' +
          '<span>' + (c.position != null ? '<span class="pill wine">pinned #' + c.position + '</span> ' : '') + (c.is_private ? '<span class="pill">private</span> ' : '<span class="pill">public</span> ') + (c.host_id ? '<span class="pill green">host connected</span> ' : '<span class="pill red">no host account</span> ') + (c.is_sample ? '<span class="pill">sample</span>' : '') + '</span></div>' +
          '<div class="actions"><a class="btn" href="./#/c/' + esc(c.slug) + '" target="_blank">View ↗</a><button data-copy="' + esc(c.slug) + '">Copy link</button><a class="btn dark" href="#communities/' + c.id + '">Edit</a></div></div>';
      }).join('') : '<p class="empty">No communities yet.</p>') + '</div>' +
      '<h2>Community pitches</h2><div class="card">' + ((pr.data || []).length ? pr.data.map(function (p) {
        var u = people[p.user_id] || {};
        return '<div class="row"><img class="av" src="' + esc(photoOf(u)) + '" alt=""><div class="grow"><b>' + esc(p.name) + ' · from ' + esc(u.first_name || 'someone') + '</b><span class="muted">' + esc(p.about) + '</span>' +
          '<span class="muted">' + esc([p.frequency, p.privacy, p.social].filter(Boolean).join(' · ')) + ' · ' + ago(p.created_at) + '</span></div></div>';
      }).join('') : '<p class="empty">No pitches yet.</p>') + '</div>';
    $$('[data-copy]').forEach(function (b) {
      b.onclick = function () {
        var url = location.href.split('admin.html')[0] + '#/c/' + b.dataset.copy;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('link copied'); }, function () { prompt('Copy this link', url); });
      };
    });
  }
  async function communityForm(id) {
    var c = { is_private: false, base_members: 0 };
    if (id !== 'new') {
      var r = await sb.from('communities').select(COMM_COLS).eq('id', id).maybeSingle();
      if (!r.data) { main.innerHTML = '<p class="empty">Community not found.</p>'; return; }
      c = r.data;
      var codes = await sb.rpc('admin_join_codes');
      (codes.data || []).forEach(function (x) { if (x.id === id) c.join_code = x.join_code; });
    }
    var host = c.host_id ? (await loadPeople([c.host_id]), people[c.host_id]) : null;
    main.innerHTML = '<div class="toolbar"><a class="btn" href="#communities">← Communities</a><h1 style="margin:0">' + (id === 'new' ? 'New community' : esc(c.name)) + '</h1></div>' +
      '<div class="card"><form class="grid" id="f">' +
      '<label>Name<input name="name" required maxlength="60" value="' + esc(c.name || '') + '"></label>' +
      '<label>Link name<input name="slug" required value="' + esc(c.slug || '') + '" placeholder="aura-matcha-community"></label>' +
      '<label class="full">Bio<textarea name="bio" maxlength="300">' + esc(c.bio || '') + '</textarea></label>' +
      '<label>Host name shown ("Hosted by …")<input name="host_name" required value="' + esc(c.host_name || '') + '"></label>' +
      '<label>Instagram handle (no @)<input name="instagram" value="' + esc(c.instagram || '') + '"></label>' +
      imageField('avatar_url', 'Logo / profile photo', c.avatar_url) +
      imageField('cover_url', 'Cover photo', c.cover_url) +
      '<label>Pin position (1 = top, empty = not pinned)<input name="position" type="number" min="1" max="99" value="' + (c.position == null ? '' : c.position) + '"></label>' +
      '<label>Extra members shown (for sample communities)<input name="base_members" type="number" min="0" value="' + (c.base_members || 0) + '"></label>' +
      '<label class="check"><input type="checkbox" name="is_private"' + (c.is_private ? ' checked' : '') + '> Private (people request or use a code)</label>' +
      '<label>Join code (private only)<input name="join_code" value="' + esc(c.join_code || '') + '" placeholder="ARTS26"></label>' +
      '</form><div class="formfoot">' + (id !== 'new' ? '<button class="danger" id="del" style="margin-right:auto">Delete community</button>' : '') + '<a class="btn" href="#communities">Cancel</a><button class="dark" id="save">Save</button></div></div>' +
      (id !== 'new' ? '<h2>Host account</h2><div class="card"><div class="row">' +
        (host ? '<img class="av" src="' + esc(photoOf(host)) + '" alt=""><div class="grow"><b>' + esc(host.first_name) + '</b><span class="muted">can post in the feed and is shown as host in chat</span></div><button data-unhost>Remove host</button>'
          : '<div class="grow"><b>No host account connected</b><span class="muted">The host signs up in the app, then you pick her here so she can post in the feed.</span></div>') +
        '</div><div class="row"><input class="search" id="hq" placeholder="Search people by first name"><div id="hres" class="grow"></div></div></div>' +
        '<h2>Post in the feed as ' + esc(c.host_name) + '</h2><div class="card"><div class="row" style="flex-direction:column;align-items:stretch">' +
        '<textarea id="cpost" maxlength="1000" placeholder="an update, a welcome, the next meetup"></textarea><div class="actions"><button class="dark" id="cpostbtn">Post</button></div></div></div>' : '');
    var f = $('#f'); bindUploads(f);
    if (id === 'new') f.elements.name.oninput = function () { if (!f.elements.slug.dataset.touched) f.elements.slug.value = slugify(this.value); };
    f.elements.slug.oninput = function () { this.dataset.touched = 1; };
    $('#save').onclick = async function () {
      if (!f.reportValidity()) return;
      var v = f.elements, row = {
        name: v.name.value.trim(), slug: slugify(v.slug.value), bio: v.bio.value.trim() || null, host_name: v.host_name.value.trim(),
        instagram: v.instagram.value.trim().replace(/^@/, '') || null, avatar_url: v.avatar_url.value.trim() || null, cover_url: v.cover_url.value.trim() || null,
        position: v.position.value ? Number(v.position.value) : null, base_members: Number(v.base_members.value || 0),
        is_private: v.is_private.checked, join_code: v.is_private.checked ? (v.join_code.value.trim().toUpperCase() || null) : null
      };
      if (row.is_private && !row.join_code) { toast('Add a join code for a private community.'); return; }
      this.disabled = true;
      var x = id === 'new' ? await sb.from('communities').insert(Object.assign(row, { is_sample: false })) : await sb.from('communities').update(row).eq('id', id);
      if (x.error) { this.disabled = false; toast('Couldn\'t save: ' + x.error.message); return; }
      toast('saved'); location.hash = '#communities';
    };
    if ($('#del')) $('#del').onclick = async function () {
      if (!confirm('Delete ' + c.name + '? Its feed, chat and members are removed too. This can\'t be undone.')) return;
      var x = await sb.from('communities').delete().eq('id', id);
      toast(x.error ? x.error.message : 'deleted'); location.hash = '#communities';
    };
    if ($('[data-unhost]')) $('[data-unhost]').onclick = async function () {
      var x = await sb.from('communities').update({ host_id: null }).eq('id', id);
      toast(x.error ? x.error.message : 'host removed'); route();
    };
    if ($('#hq')) $('#hq').oninput = async function () {
      var q = this.value.trim(); if (q.length < 2) { $('#hres').innerHTML = ''; return; }
      var r = await sb.from('profiles').select('id, first_name, age_range, neighborhood, photos').ilike('first_name', q + '%').limit(8);
      $('#hres').innerHTML = (r.data || []).map(function (p) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><img class="av" style="width:28px;height:28px" src="' + esc(photoOf(p)) + '" alt=""><span style="flex:1">' + esc(p.first_name) + ' <span class="muted">' + esc(p.age_range + ' · ' + p.neighborhood) + '</span></span><button data-host="' + p.id + '">Make host</button></div>';
      }).join('') || '<span class="muted">No one by that name.</span>';
      $$('[data-host]').forEach(function (b) {
        b.onclick = async function () {
          var x = await sb.from('communities').update({ host_id: b.dataset.host }).eq('id', id);
          toast(x.error ? x.error.message : 'host connected'); route();
        };
      });
    };
    if ($('#cpostbtn')) $('#cpostbtn').onclick = async function () {
      var body = $('#cpost').value.trim(); if (!body) return;
      this.disabled = true;
      var x = await sb.from('community_posts').insert({ community_id: id, author_name: c.host_name, body: body });
      if (x.error) { this.disabled = false; toast('Couldn\'t post: ' + x.error.message); return; }
      toast('posted'); $('#cpost').value = ''; this.disabled = false;
    };
  }

  // ---------- people ----------
  async function viewPeople() {
    main.innerHTML = '<h1>People</h1><p class="sub">Everyone who finished sign up. Suspended people can still open the app but can\'t post, chat or join.</p>' +
      '<div class="toolbar"><input class="search" id="q" placeholder="Search by first name"><select id="flt" style="width:auto"><option value="">everyone</option><option value="new">joined this week</option><option value="banned">suspended</option></select></div><div class="card" id="list"></div>';
    async function draw() {
      var q = $('#q').value.trim(), flt = $('#flt').value;
      var r = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
      if (q) r = r.ilike('first_name', q + '%');
      if (flt === 'new') r = r.gte('created_at', weekAgo());
      if (flt === 'banned') r = r.not('banned_at', 'is', null);
      var res = await r, list = res.data || [];
      list.forEach(function (p) { people[p.id] = p; });
      $('#list').innerHTML = list.length ? list.map(function (p) {
        return '<div class="row"><img class="av" src="' + esc(photoOf(p)) + '" alt=""><div class="grow"><b>' + esc(p.first_name) + (p.banned_at ? ' <span class="pill red">suspended</span>' : '') + '</b>' +
          '<span class="muted">' + esc([p.age_range, p.neighborhood, p.where_status, p.instagram ? '@' + p.instagram : null].filter(Boolean).join(' · ')) + ' · joined ' + ago(p.created_at) + '</span>' +
          (p.bio ? '<span class="muted">' + esc(p.bio) + '</span>' : '') + '</div>' +
          '<div class="actions"><a class="btn" href="./#/u/' + p.id + '" target="_blank">Profile ↗</a>' +
          (p.id === me.id ? '' : p.banned_at ? '<button data-unban="' + p.id + '">Unsuspend</button>' : '<button class="danger" data-ban="' + p.id + '">Suspend</button>') + '</div></div>';
      }).join('') : '<p class="empty">No one found.</p>';
      bindBans(draw);
    }
    $('#q').oninput = draw; $('#flt').onchange = draw;
    await draw();
  }
  function bindBans(after) {
    $$('[data-ban]').forEach(function (b) {
      b.onclick = async function () {
        var p = people[b.dataset.ban] || {};
        if (!confirm('Suspend ' + (p.first_name || 'this person') + '? She won\'t be able to post, chat or join anything.')) return;
        var x = await sb.from('profiles').update({ banned_at: new Date().toISOString() }).eq('id', b.dataset.ban);
        toast(x.error ? x.error.message : 'suspended'); after();
      };
    });
    $$('[data-unban]').forEach(function (b) {
      b.onclick = async function () {
        var x = await sb.from('profiles').update({ banned_at: null }).eq('id', b.dataset.unban);
        toast(x.error ? x.error.message : 'unsuspended'); after();
      };
    });
  }

  // ---------- reports ----------
  async function viewReports() {
    var r = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(100);
    var list = r.data || [];
    var noteIds = list.filter(function (x) { return x.target_type === 'note' && x.target_id; }).map(function (x) { return x.target_id; });
    var notes = {};
    if (noteIds.length) { var nr = await sb.from('notes').select('id, body').in('id', noteIds); (nr.data || []).forEach(function (n) { notes[n.id] = n; }); }
    await loadPeople(list.map(function (x) { return x.reporter_id; }).concat(list.map(function (x) { return x.reported_user_id; })));
    var open = list.filter(function (x) { return x.status === 'open'; }), done = list.filter(function (x) { return x.status !== 'open'; });
    function rowOf(x) {
      var who = people[x.reported_user_id] || {}, by = people[x.reporter_id] || {};
      var what = x.target_type === 'note' ? (notes[x.target_id] ? 'note: "' + notes[x.target_id].body + '"' : 'note (already removed)') : 'profile';
      return '<div class="row"><img class="av" src="' + esc(photoOf(who)) + '" alt=""><div class="grow"><b>' + esc(who.first_name || 'someone') + ' · ' + esc(x.reason) + (who.banned_at ? ' <span class="pill red">suspended</span>' : '') + '</b>' +
        '<span class="muted">' + esc(what) + '</span>' + (x.details ? '<span class="muted">"' + esc(x.details) + '"</span>' : '') +
        '<span class="muted">reported by ' + esc(by.first_name || 'someone') + ' · ' + ago(x.created_at) + (x.status !== 'open' ? ' · ' + x.status : '') + '</span></div>' +
        (x.status === 'open' ? '<div class="actions">' +
          (x.target_type === 'note' && notes[x.target_id] ? '<button data-rmnote="' + x.id + '|' + x.target_id + '">Remove note</button>' : '') +
          (who.id && !who.banned_at ? '<button class="danger" data-banrep="' + x.id + '|' + who.id + '">Suspend</button>' : '') +
          '<button data-dismiss="' + x.id + '">Dismiss</button></div>' : '') + '</div>';
    }
    main.innerHTML = '<h1>Reports</h1><p class="sub">What members reported from the app. Review each one, then remove, suspend or dismiss.</p>' +
      '<h2>Open (' + open.length + ')</h2><div class="card">' + (open.length ? open.map(rowOf).join('') : '<p class="empty">Nothing to review.</p>') + '</div>' +
      '<h2>Handled</h2><div class="card">' + (done.length ? done.map(rowOf).join('') : '<p class="empty">None yet.</p>') + '</div>';
    async function close(id, status) { await sb.from('reports').update({ status: status }).eq('id', id); }
    $$('[data-dismiss]').forEach(function (b) { b.onclick = async function () { await close(b.dataset.dismiss, 'dismissed'); toast('dismissed'); refreshCount(); route(); }; });
    $$('[data-rmnote]').forEach(function (b) {
      b.onclick = async function () {
        var k = b.dataset.rmnote.split('|');
        if (!confirm('Remove this note for everyone?')) return;
        var x = await sb.from('notes').delete().eq('id', k[1]);
        if (x.error) { toast(x.error.message); return; }
        await close(k[0], 'actioned'); toast('note removed'); refreshCount(); route();
      };
    });
    $$('[data-banrep]').forEach(function (b) {
      b.onclick = async function () {
        var k = b.dataset.banrep.split('|');
        if (!confirm('Suspend this person? She won\'t be able to post, chat or join anything.')) return;
        var x = await sb.from('profiles').update({ banned_at: new Date().toISOString() }).eq('id', k[1]);
        if (x.error) { toast(x.error.message); return; }
        await close(k[0], 'actioned'); toast('suspended'); refreshCount(); route();
      };
    });
  }
  async function refreshCount() {
    var r = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open');
    openReports = r.count || 0;
    drawTabs((location.hash.replace(/^#/, '') || 'overview').split('/')[0]);
  }

  // ---------- gate ----------
  async function start() {
    var s = await sb.auth.getSession();
    me = s.data.session ? s.data.session.user : null;
    if (!me) {
      main.innerHTML = '<div class="gate"><div class="mark">moments<span>.</span><small>admin</small></div><b>Sign in on the app first</b>' +
        '<p class="muted" style="margin:0">Open the Moments app in this same browser, sign in with your email link, then come back to this page.</p>' +
        '<a class="btn dark" href="./" style="align-self:flex-start">Open the app</a></div>';
      return;
    }
    var a = await sb.rpc('is_admin');
    if (a.error || !a.data) {
      main.innerHTML = '<div class="gate"><div class="mark">moments<span>.</span><small>admin</small></div><b>This account isn\'t an admin yet</b>' +
        (a.error ? '<p class="muted" style="margin:0">Run <b>10-admin.sql</b> in Supabase first (SQL Editor → New query → paste → Run), then reload this page.</p>' : '') +
        '<p class="muted" style="margin:0">To make <b>' + esc(me.email || 'this account') + '</b> the admin, run this one line in Supabase → SQL Editor → New query:</p>' +
        '<pre>insert into public.admins (user_id) values (\'' + esc(me.id) + '\') on conflict do nothing;</pre>' +
        '<div style="display:flex;gap:8px"><button class="dark" id="cp">Copy the line</button><button onclick="location.reload()">I ran it, reload</button></div>' +
        '<p class="muted" style="margin:0">Only someone who can open your Supabase project can do this, so no one else can make themselves admin.</p></div>';
      document.getElementById('cp').onclick = function () {
        var line = 'insert into public.admins (user_id) values (\'' + me.id + '\') on conflict do nothing;';
        (navigator.clipboard ? navigator.clipboard.writeText(line) : Promise.reject()).then(function () { toast('copied'); }, function () { prompt('Copy this line', line); });
      };
      return;
    }
    document.getElementById('top').hidden = false;
    window.addEventListener('hashchange', route);
    await refreshCount();
    route();
  }
  start();
})();
