/* Moments, round 1: sign up, profiles, notes, join, group chats. */
(function () {
  'use strict';

  var cfg = window.MOMENTS_CONFIG;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  var AGES = ['21-25', '26-30', '31-35', '36+'];
  var WHERE = ['live here', 'moving here soon', 'traveling'];
  var HOODS = ['Brickell', 'Downtown', 'Edgewater', 'Wynwood', 'Midtown', 'Design District', 'Little Havana', 'Little River', 'Coconut Grove', 'Coral Gables', 'South Beach', 'Mid-Beach', 'North Beach', 'Key Biscayne', 'Doral', 'Kendall', 'Aventura', 'North Miami', 'Other'];
  var MOMENTS = ['wellness moments', 'pop-up moments', 'rooftop moments', 'creative moments', 'book moments', 'faith moments', 'career moments'];
  var RULES = [
    ['Moments is for women, 21 and up.', 'Everyone here is a woman aged 21 or older.'],
    ['Be kind.', 'No harassment, hate or bullying. We remove people who make others feel unsafe.'],
    ['Show up.', 'If you join a plan, go. If you can\'t, leave the plan so someone else can take your spot.'],
    ['Meet in public first.', 'Pick public places for first meetups and tell a friend where you\'re going.'],
    ['No selling.', 'Don\'t use Moments to sell, recruit or promote without permission.']
  ];

  var app = document.getElementById('app');
  var tabs = document.getElementById('tabs');
  var me = null;          // auth user
  var profile = null;     // my profile row
  var profileCache = {};
  var chatChannel = null;
  var draft = {};         // onboarding answers

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || app).querySelectorAll(sel)); }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function initial(name) { return esc((name || '?').trim().charAt(0).toUpperCase()); }
  function avatar(p, size) {
    var cls = 'avatar' + (size ? ' ' + size : '');
    if (p && p.photos && p.photos[0]) return '<img class="' + cls + '" src="' + esc(p.photos[0]) + '" alt="">';
    return '<span class="' + cls + '">' + initial(p && p.first_name) + '</span>';
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function icon(name) {
    var p = {
      back: '<path d="M15 5 8 12l7 7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
      clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/>',
      send: '<path d="M4 12 20 4l-6 16-3-7z"/>'
    }[name];
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  }
  function top(title, backHash) {
    return '<div class="top">' +
      (backHash ? '<a class="icon-btn" href="' + backHash + '" aria-label="Back">' + icon('back') + '</a>' : '<a class="wordmark" href="#/">moments<span>.</span></a>') +
      (title ? '<div class="grow who center">' + esc(title) + '</div>' : '<div class="grow"></div>') +
      (backHash ? '<span style="width:44px"></span>' : '') + '</div>';
  }
  function setChrome(tab, bare) {
    tabs.hidden = !tab;
    document.body.classList.toggle('bare', !!bare);
    $$('a', tabs).forEach(function (a) { a.classList.toggle('on', a.dataset.tab === tab); });
  }
  function loading() { app.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>'; }
  function stopChat() { if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; } }

  async function getProfiles(ids) {
    var need = ids.filter(function (id) { return id && !profileCache[id]; });
    need = need.filter(function (v, i) { return need.indexOf(v) === i; });
    if (need.length) {
      var r = await sb.from('profiles').select('*').in('id', need);
      (r.data || []).forEach(function (p) { profileCache[p.id] = p; });
    }
    return profileCache;
  }

  async function loadMe() {
    var s = await sb.auth.getSession();
    me = s.data.session ? s.data.session.user : null;
    profile = null;
    if (me) {
      var r = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
      profile = r.data || null;
      if (profile) profileCache[profile.id] = profile;
    }
  }

  // ---------- router ----------
  async function route() {
    stopChat();
    var h = location.hash.replace(/^#/, '') || '/';
    if (/access_token|error_description/.test(h)) h = '/';
    var parts = h.split('/').filter(Boolean);
    window.scrollTo(0, 0);

    if (!me) return viewSignIn();
    if (!profile || !profile.rules_accepted_at) return viewOnboarding(parts[0] === 'join' ? Number(parts[1]) || 1 : 1);

    switch (parts[0]) {
      case undefined: return viewHome();
      case 'new': return viewNewNote();
      case 'note': return viewNote(parts[1]);
      case 'chat': return viewChat(parts[1]);
      case 'chats': return viewChats();
      case 'me': return viewProfile(me.id, true);
      case 'edit': return viewEdit();
      case 'u': return viewProfile(parts[1], false);
      case 'communities': return viewSoon('communities', 'communities', 'Communities run by hosts, with their own feed and chat. Coming in round 2.');
      case 'discover': return viewSoon('discover', 'discover', 'Events around Miami by vibe, with ticket links. Coming in round 3.');
      default: return viewHome();
    }
  }

  // ---------- sign in ----------
  function viewSignIn(sentTo) {
    setChrome(null, true);
    if (sentTo) {
      app.innerHTML = '<div class="screen-fill"><div class="stack">' + top() +
        '<h1 class="h2">check your email.</h1>' +
        '<p class="lede">We sent a sign-in link to <b>' + esc(sentTo) + '</b>. Open it on this phone to come back here signed in.</p>' +
        '<p class="small">Nothing there? Check spam, or wait a minute and try again.</p></div>' +
        '<button class="btn ghost block" data-again>Use a different email</button></div>';
      $('[data-again]').onclick = function () { viewSignIn(); };
      return;
    }
    app.innerHTML = '<div class="screen-fill"><div class="stack">' + top() +
      '<h1 class="h1" style="margin-top:28px">create moments,<br>find your people.</h1>' +
      '<p class="lede">Plans, communities and new friends in Miami. Sign in with your email, no password needed.</p></div>' +
      '<form class="stack" novalidate>' +
      '<label class="field">Email<input class="input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@email.com" required></label>' +
      '<p class="error" id="err"></p>' +
      '<button class="btn dark block" type="submit">Send me a link</button></form></div>';
    $('form').onsubmit = async function (e) {
      e.preventDefault();
      var email = this.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#err').textContent = 'Enter a valid email.'; return; }
      var btn = $('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      var redirect = location.origin + location.pathname;
      var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } });
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Send me a link';
        $('#err').textContent = /rate|limit|seconds/i.test(r.error.message) ? 'Too many tries. Wait a minute and try again.' : r.error.message;
        return;
      }
      viewSignIn(email);
    };
  }

  // ---------- onboarding ----------
  function onboardFrame(step, inner, cta) {
    var bars = ''; for (var i = 1; i <= 5; i++) bars += '<span class="' + (i <= step ? 'on' : '') + '"></span>';
    return '<div class="screen-fill"><div class="stack">' +
      '<div class="top">' + (step > 1 ? '<a class="icon-btn" href="#/join/' + (step - 1) + '" aria-label="Back">' + icon('back') + '</a>' : '<span class="wordmark">moments<span>.</span></span>') + '<span class="small">' + step + ' of 5</span></div>' +
      '<div class="progress">' + bars + '</div>' + inner + '</div>' +
      '<div class="stack"><p class="error" id="err"></p><button class="btn dark block" data-next>' + (cta || 'Continue') + '</button></div></div>';
  }

  function viewOnboarding(step) {
    setChrome(null, true);
    if (profile) {
      draft.first_name = draft.first_name || profile.first_name;
      draft.age_range = draft.age_range || profile.age_range;
      draft.neighborhood = draft.neighborhood || profile.neighborhood;
      draft.where_status = draft.where_status || profile.where_status;
      draft.interests = draft.interests || profile.interests;
      draft.photos = draft.photos || profile.photos;
    }
    draft.photos = draft.photos || [];
    draft.interests = draft.interests || [];
    if (step > 1 && !draft.first_name) step = 1;

    if (step === 1) {
      app.innerHTML = onboardFrame(1,
        '<h1 class="h2">let\'s start with you.</h1>' +
        '<label class="field">First name<input class="input" name="first_name" maxlength="40" autocomplete="given-name" value="' + esc(draft.first_name || '') + '"></label>' +
        '<div class="field"><b style="font-size:14px">Age</b><div class="pills">' + AGES.map(function (a) { return '<label class="pill"><input type="radio" name="age" value="' + a + '"' + (draft.age_range === a ? ' checked' : '') + '>' + a + '</label>'; }).join('') + '</div></div>' +
        '<label class="check"><input type="checkbox" name="ok"' + (draft.ok ? ' checked' : '') + '><span>I\'m a woman and I\'m 21 or older.</span></label>');
      $('[data-next]').onclick = function () {
        var name = $('[name=first_name]').value.trim(), age = ($('[name=age]:checked') || {}).value;
        if (!name) return ($('#err').textContent = 'Add your first name.');
        if (!age) return ($('#err').textContent = 'Pick your age range.');
        if (!$('[name=ok]').checked) return ($('#err').textContent = 'Moments is for women 21 and up.');
        draft.first_name = name; draft.age_range = age; draft.ok = true; go('#/join/2');
      };
    } else if (step === 2) {
      app.innerHTML = onboardFrame(2,
        '<h1 class="h2">add a few photos.</h1><p class="lede" style="margin:0">At least one where your face is clear. Up to three.</p>' +
        '<div class="photo-grid" id="slots"></div>');
      renderSlots();
      $('[data-next]').onclick = function () {
        if (!draft.photos.length) return ($('#err').textContent = 'Add at least one photo.');
        go('#/join/3');
      };
    } else if (step === 3) {
      app.innerHTML = onboardFrame(3,
        '<h1 class="h2">where are you in miami?</h1>' +
        '<label class="field">Neighborhood<select class="input" name="hood"><option value="">Choose one</option>' + HOODS.map(function (n) { return '<option' + (draft.neighborhood === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<div class="field"><b style="font-size:14px">Right now I</b><div class="pills">' + WHERE.map(function (w) { return '<label class="pill"><input type="radio" name="where" value="' + w + '"' + ((draft.where_status || 'live here') === w ? ' checked' : '') + '>' + (w === 'traveling' ? 'I\'m traveling' : w) + '</label>'; }).join('') + '</div></div>');
      $('[data-next]').onclick = function () {
        var hood = $('[name=hood]').value;
        if (!hood) return ($('#err').textContent = 'Pick your neighborhood.');
        draft.neighborhood = hood; draft.where_status = $('[name=where]:checked').value; go('#/join/4');
      };
    } else if (step === 4) {
      app.innerHTML = onboardFrame(4,
        '<h1 class="h2">what are your favorite moments?</h1><p class="lede" style="margin:0">Pick as many as you like.</p>' +
        '<div class="pills">' + MOMENTS.map(function (m) { return '<label class="pill"><input type="checkbox" name="m" value="' + m + '"' + (draft.interests.indexOf(m) > -1 ? ' checked' : '') + '>' + m + '</label>'; }).join('') + '</div>');
      $('[data-next]').onclick = function () {
        var picked = $$('[name=m]:checked').map(function (i) { return i.value; });
        if (!picked.length) return ($('#err').textContent = 'Pick at least one.');
        draft.interests = picked; go('#/join/5');
      };
    } else {
      app.innerHTML = onboardFrame(5,
        '<h1 class="h2">our house rules.</h1>' +
        '<div class="stack">' + RULES.map(function (r) { return '<div><b>' + esc(r[0]) + '</b><p class="lede" style="margin-top:2px">' + esc(r[1]) + '</p></div>'; }).join('') + '</div>' +
        '<label class="check"><input type="checkbox" name="agree"><span>I agree to the Moments house rules.</span></label>', 'Join moments');
      $('[data-next]').onclick = async function () {
        if (!$('[name=agree]').checked) return ($('#err').textContent = 'Agree to the rules to continue.');
        var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
        var row = { id: me.id, first_name: draft.first_name, age_range: draft.age_range, neighborhood: draft.neighborhood, where_status: draft.where_status || 'live here', interests: draft.interests, photos: draft.photos, rules_accepted_at: new Date().toISOString() };
        var r = await sb.from('profiles').upsert(row).select().single();
        if (r.error) { btn.disabled = false; btn.textContent = 'Join moments'; $('#err').textContent = r.error.message; return; }
        profile = r.data; profileCache[profile.id] = profile; draft = {};
        location.hash = '#/'; toast('welcome to moments, ' + profile.first_name + '.');
      };
    }
  }

  function renderSlots(target) {
    var box = target || $('#slots'); var html = '';
    for (var i = 0; i < 3; i++) {
      var url = draft.photos[i];
      html += url
        ? '<div class="photo-slot"><img src="' + esc(url) + '" alt="Your photo ' + (i + 1) + '"><button class="x" data-rm="' + i + '" aria-label="Remove photo">✕</button></div>'
        : '<label class="photo-slot" aria-label="Add a photo">+<input type="file" accept="image/*"></label>';
    }
    box.innerHTML = html;
    $$('[data-rm]', box).forEach(function (b) { b.onclick = function (e) { e.preventDefault(); draft.photos.splice(Number(b.dataset.rm), 1); renderSlots(box); }; });
    $$('input[type=file]', box).forEach(function (inp) {
      inp.onchange = async function () {
        var f = inp.files[0]; if (!f) return;
        inp.parentNode.innerHTML = '<div class="spinner" style="margin:0"></div>';
        try { draft.photos.push(await uploadPhoto(f)); } catch (err) { toast('That photo didn\'t upload. Try another.'); }
        renderSlots(box);
      };
    });
  }

  // Shrink to max 1280px JPEG before upload, so photos load fast.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(); var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('resize failed')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { reject(new Error('not an image')); };
      img.src = url;
    });
  }
  async function uploadPhoto(file) {
    var blob = await shrink(file);
    var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
    var r = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (r.error) throw r.error;
    return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  // ---------- home feed ----------
  async function viewHome() {
    setChrome('home'); loading();
    var r = await sb.from('notes').select('*, note_members(user_id)').order('created_at', { ascending: false }).limit(60);
    if (r.error) { app.innerHTML = top() + '<p class="empty">Couldn\'t load notes. Pull down to refresh.</p>'; return; }
    var notes = r.data || [];
    await getProfiles(notes.map(function (n) { return n.author_id; }));
    app.innerHTML = top() +
      '<div class="stack">' + (notes.length ? notes.map(noteCard).join('') : '<div class="empty">No plans yet.<br>Tap + to post the first one.</div>') + '</div>' +
      '<a class="fab" href="#/new" aria-label="Post a plan">' + icon('plus') + '</a>';
    bindJoin();
  }

  function noteState(n) {
    var guests = (n.note_members || []).filter(function (m) { return m.user_id !== n.author_id; });
    var joined = (n.note_members || []).some(function (m) { return m.user_id === me.id; });
    return { left: Math.max(0, n.spots - guests.length), joined: joined, mine: n.author_id === me.id, guests: guests };
  }

  function noteCard(n) {
    var a = profileCache[n.author_id] || {}; var st = noteState(n);
    var btn = st.mine ? '<a class="btn ghost small" href="#/chat/' + n.id + '">Your plan · chat</a>'
      : st.joined ? '<a class="btn ghost small" href="#/chat/' + n.id + '">Joined · open chat</a>'
      : st.left ? '<button class="btn dark small" data-join="' + n.id + '">Join</button>'
      : '<button class="btn ghost small" disabled>Full</button>';
    return '<article class="card note">' +
      '<a class="row" href="#/u/' + n.author_id + '" style="text-decoration:none">' + avatar(a) +
      '<div class="grow"><div class="who">' + esc(a.first_name || 'someone') + '</div><div class="small">' + esc([a.age_range, a.where_status === 'traveling' ? 'traveling' : a.neighborhood].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="small">' + ago(n.created_at) + '</span></a>' +
      '<a href="#/note/' + n.id + '" style="text-decoration:none"><p class="note-body">' + esc(n.body) + '</p></a>' +
      ((n.place || n.starts_at) ? '<div class="chips">' + (n.place ? '<span class="chip">' + esc(n.place) + '</span>' : '') + (n.starts_at ? '<span class="chip">' + esc(when(n.starts_at)) + '</span>' : '') + '</div>' : '') +
      '<div class="row"><span class="grow spots' + (st.left ? '' : ' full') + '">' + (st.left ? st.left + (st.left === 1 ? ' spot left' : ' spots left') : 'full') + '</span>' + btn + '</div>' +
      '</article>';
  }

  function bindJoin() {
    $$('[data-join]').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Joining…';
        var r = await sb.rpc('join_note', { p_note: b.dataset.join });
        if (r.error) { b.disabled = false; b.textContent = 'Join'; toast('Couldn\'t join. Try again.'); return; }
        if (r.data === 'full') { toast('That plan just filled up.'); route(); return; }
        toast('you\'re in. say hi in the chat.'); go('#/chat/' + b.dataset.join);
      };
    });
  }

  // ---------- new note ----------
  function viewNewNote() {
    setChrome(null, true);
    app.innerHTML = top('new plan', '#/') +
      '<form class="stack" novalidate>' +
      '<label class="field">What\'s the plan?<textarea class="input" name="body" maxlength="500" placeholder="sunset walk at south pointe, then tacos. who\'s in?"></textarea></label>' +
      '<label class="field">Where (optional)<input class="input" name="place" maxlength="120" placeholder="South Pointe Park"></label>' +
      '<label class="field">When (optional)<input class="input" name="starts_at" type="datetime-local"></label>' +
      '<div class="field"><b style="font-size:14px">Spots for others</b><div class="row"><button type="button" class="btn ghost small" data-d="-1" aria-label="Fewer spots">−</button><b id="spots" style="min-width:32px;text-align:center;font-size:20px">3</b><button type="button" class="btn ghost small" data-d="1" aria-label="More spots">+</button></div></div>' +
      '<p class="error" id="err"></p><button class="btn wine block" type="submit">Post plan</button></form>';
    var spots = 3;
    $$('[data-d]').forEach(function (b) { b.onclick = function () { spots = Math.min(20, Math.max(1, spots + Number(b.dataset.d))); $('#spots').textContent = spots; }; });
    $('form').onsubmit = async function (e) {
      e.preventDefault();
      var body = this.body.value.trim();
      if (!body) { $('#err').textContent = 'Write what the plan is.'; return; }
      var row = { author_id: me.id, body: body, place: this.place.value.trim() || null, starts_at: this.starts_at.value ? new Date(this.starts_at.value).toISOString() : null, spots: spots };
      var btn = $('button[type=submit]'); btn.disabled = true; btn.textContent = 'Posting…';
      var r = await sb.from('notes').insert(row).select().single();
      if (r.error) { btn.disabled = false; btn.textContent = 'Post plan'; $('#err').textContent = r.error.message; return; }
      toast('your plan is up.'); go('#/');
    };
  }

  // ---------- note detail ----------
  async function viewNote(id) {
    setChrome('home'); loading();
    var r = await sb.from('notes').select('*, note_members(user_id)').eq('id', id).maybeSingle();
    if (!r.data) { app.innerHTML = top('', '#/') + '<p class="empty">This plan was removed.</p>'; return; }
    var n = r.data, st = noteState(n);
    await getProfiles([n.author_id].concat((n.note_members || []).map(function (m) { return m.user_id; })));
    var going = st.guests.map(function (m) { return profileCache[m.user_id]; }).filter(Boolean);
    app.innerHTML = top('', '#/') + '<div class="stack">' + noteCard(n) +
      '<div class="card stack"><b>Who\'s going</b>' +
      (going.length ? going.map(function (p) { return '<a class="row" href="#/u/' + p.id + '" style="text-decoration:none">' + avatar(p) + '<div><div class="who">' + esc(p.first_name) + '</div><div class="small">' + esc(p.age_range + ' · ' + p.neighborhood) + '</div></div></a>'; }).join('') : '<p class="small" style="margin:0">No one yet. Be the first.</p>') +
      '</div>' +
      (st.joined && !st.mine ? '<button class="btn ghost block" data-leave>Leave this plan</button>' : '') +
      (st.mine ? '<button class="btn ghost block" data-del>Delete this plan</button>' : '') + '</div>';
    bindJoin();
    if ($('[data-leave]')) $('[data-leave]').onclick = async function () {
      if (!confirm('Leave this plan? Your spot opens up for someone else.')) return;
      await sb.from('note_members').delete().eq('note_id', id).eq('user_id', me.id); toast('you left the plan.'); route();
    };
    if ($('[data-del]')) $('[data-del]').onclick = async function () {
      if (!confirm('Delete this plan and its chat for everyone?')) return;
      var d = await sb.from('notes').delete().eq('id', id);
      if (d.error) return toast('Couldn\'t delete. Try again.');
      toast('plan deleted.'); go('#/');
    };
  }

  // ---------- chats ----------
  async function viewChats() {
    setChrome('chats'); loading();
    var r = await sb.from('note_members').select('note_id, notes(id, body, author_id, created_at)').eq('user_id', me.id);
    var rows = (r.data || []).filter(function (x) { return x.notes; });
    var ids = rows.map(function (x) { return x.note_id; });
    var last = {};
    if (ids.length) {
      var m = await sb.from('messages').select('note_id, body, user_id, created_at').in('note_id', ids).order('created_at', { ascending: false }).limit(300);
      (m.data || []).forEach(function (x) { if (!last[x.note_id]) last[x.note_id] = x; });
    }
    rows.sort(function (a, b) { return new Date((last[b.note_id] || b.notes).created_at) - new Date((last[a.note_id] || a.notes).created_at); });
    await getProfiles(rows.map(function (x) { return x.notes.author_id; }));
    app.innerHTML = top() + '<h1 class="h2" style="margin-bottom:6px">chats</h1>' +
      (rows.length ? '<div>' + rows.map(function (x) {
        var a = profileCache[x.notes.author_id] || {}, l = last[x.note_id];
        return '<a class="list-row" href="#/chat/' + x.note_id + '">' + avatar(a) + '<div class="grow"><div class="who clip">' + esc(x.notes.body) + '</div><div class="small clip">' + (l ? esc(l.body) : 'No messages yet') + '</div></div><span class="small">' + ago((l || x.notes).created_at) + '</span></a>';
      }).join('') + '</div>' : '<div class="empty">Join a plan and its group chat shows up here.</div>');
  }

  async function viewChat(id) {
    setChrome(null, true); loading();
    var n = await sb.from('notes').select('*, note_members(user_id)').eq('id', id).maybeSingle();
    if (!n.data) { app.innerHTML = top('', '#/chats') + '<p class="empty">This plan was removed.</p>'; return; }
    var note = n.data, members = (note.note_members || []).map(function (m) { return m.user_id; });
    if (members.indexOf(me.id) < 0) { go('#/note/' + id); return; }
    await getProfiles(members);
    var r = await sb.from('messages').select('*').eq('note_id', id).order('created_at').limit(500);
    var msgs = r.data || [];
    app.innerHTML = '<div class="top"><a class="icon-btn" href="#/chats" aria-label="Back">' + icon('back') + '</a>' +
      '<a class="grow" href="#/note/' + id + '" style="text-decoration:none"><div class="who clip">' + esc(note.body) + '</div><div class="small">' + members.length + ' going · tap for details</div></a>' +
      '<div class="faces">' + members.slice(0, 3).map(function (u) { return avatar(profileCache[u], 'sm'); }).join('') + '</div></div>' +
      '<div class="chat" id="chat"></div>' +
      '<div class="composer"><form><input class="input grow" name="body" maxlength="1000" placeholder="message the group" autocomplete="off" aria-label="Message"><button class="btn wine" style="min-height:46px;padding:0 18px" aria-label="Send">Send</button></form></div>';
    var box = $('#chat'), seen = {};
    function add(m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      var p = profileCache[m.user_id] || {}, mine = m.user_id === me.id;
      var el = document.createElement('div'); el.className = 'msg' + (mine ? ' mine' : '');
      el.innerHTML = (mine ? '' : avatar(p, 'sm')) + '<div>' + (mine ? '' : '<p class="name">' + esc(p.first_name || '') + '</p>') + '<div class="bubble">' + esc(m.body) + '</div></div>';
      box.appendChild(el);
    }
    if (!msgs.length) box.innerHTML = '<p class="empty" id="hint">Say hi and pick a spot to meet.</p>';
    msgs.forEach(add);
    window.scrollTo(0, document.body.scrollHeight);
    chatChannel = sb.channel('chat-' + id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'note_id=eq.' + id }, async function (payload) {
      await getProfiles([payload.new.user_id]); var h = $('#hint'); if (h) h.remove(); add(payload.new); window.scrollTo(0, document.body.scrollHeight);
    }).subscribe();
    $('.composer form').onsubmit = async function (e) {
      e.preventDefault();
      var body = this.body.value.trim(); if (!body) return;
      this.body.value = '';
      var ins = await sb.from('messages').insert({ note_id: id, user_id: me.id, body: body }).select().single();
      if (ins.error) { toast('Didn\'t send. Try again.'); this.body.value = body; return; }
      var h = $('#hint'); if (h) h.remove(); add(ins.data); window.scrollTo(0, document.body.scrollHeight);
    };
  }

  // ---------- profiles ----------
  async function viewProfile(id, isMe) {
    setChrome(isMe ? 'me' : 'home'); loading();
    await getProfiles([id]);
    var p = profileCache[id];
    if (!p) { app.innerHTML = top('', '#/') + '<p class="empty">Profile not found.</p>'; return; }
    app.innerHTML = (isMe ? top() : top('', '#/')) + '<div class="stack">' +
      (p.photos.length ? '<div class="profile-photos">' + p.photos.map(function (u) { return '<img src="' + esc(u) + '" alt="">'; }).join('') + '</div>' : '<div class="center">' + avatar(p, 'lg') + '</div>') +
      '<div><h1 class="h2">' + esc(p.first_name) + '</h1><p class="lede">' + esc(p.age_range + ' · ' + (p.where_status === 'traveling' ? 'traveling in miami' : p.where_status === 'moving here soon' ? 'moving to ' + p.neighborhood + ' soon' : p.neighborhood)) + '</p></div>' +
      (p.bio ? '<p style="margin:0;line-height:1.45">' + esc(p.bio) + '</p>' : '') +
      (p.interests.length ? '<div class="chips">' + p.interests.map(function (i) { return '<span class="chip">' + esc(i) + '</span>'; }).join('') + '</div>' : '') +
      (p.instagram ? '<a class="small" href="https://instagram.com/' + encodeURIComponent(p.instagram) + '" target="_blank" rel="noopener">@' + esc(p.instagram) + '</a>' : '') +
      (isMe ? '<a class="btn dark block" href="#/edit">Edit profile</a><button class="btn ghost block" data-out>Sign out</button>' : '') + '</div>';
    if (isMe) $('[data-out]').onclick = async function () { await sb.auth.signOut(); me = null; profile = null; profileCache = {}; go('#/'); };
  }

  function viewEdit() {
    setChrome(null, true);
    draft = { photos: profile.photos.slice() };
    app.innerHTML = top('edit profile', '#/me') + '<form class="stack" novalidate>' +
      '<div class="photo-grid" id="slots"></div>' +
      '<label class="field">First name<input class="input" name="first_name" maxlength="40" value="' + esc(profile.first_name) + '"></label>' +
      '<label class="field">About you (optional)<textarea class="input" name="bio" maxlength="300" placeholder="new to brickell, always down for a pilates class and a good book.">' + esc(profile.bio || '') + '</textarea></label>' +
      '<label class="field">Instagram (optional)<input class="input" name="instagram" maxlength="30" placeholder="yourhandle" value="' + esc(profile.instagram || '') + '"></label>' +
      '<div class="field"><b style="font-size:14px">Age</b><div class="pills">' + AGES.map(function (a) { return '<label class="pill"><input type="radio" name="age" value="' + a + '"' + (profile.age_range === a ? ' checked' : '') + '>' + a + '</label>'; }).join('') + '</div></div>' +
      '<label class="field">Neighborhood<select class="input" name="hood">' + HOODS.map(function (n) { return '<option' + (profile.neighborhood === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<div class="field"><b style="font-size:14px">Right now I</b><div class="pills">' + WHERE.map(function (w) { return '<label class="pill"><input type="radio" name="where" value="' + w + '"' + (profile.where_status === w ? ' checked' : '') + '>' + (w === 'traveling' ? 'I\'m traveling' : w) + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><b style="font-size:14px">Favorite moments</b><div class="pills">' + MOMENTS.map(function (m) { return '<label class="pill"><input type="checkbox" name="m" value="' + m + '"' + (profile.interests.indexOf(m) > -1 ? ' checked' : '') + '>' + m + '</label>'; }).join('') + '</div></div>' +
      '<p class="error" id="err"></p><button class="btn dark block" type="submit">Save</button></form>';
    renderSlots();
    $('form').onsubmit = async function (e) {
      e.preventDefault();
      var f = this, name = f.first_name.value.trim();
      if (!name) { $('#err').textContent = 'Add your first name.'; return; }
      if (!draft.photos.length) { $('#err').textContent = 'Keep at least one photo.'; return; }
      var interests = $$('[name=m]:checked').map(function (i) { return i.value; });
      var upd = { first_name: name, bio: f.bio.value.trim() || null, instagram: f.instagram.value.trim().replace(/^@+/, '') || null, age_range: $('[name=age]:checked').value, neighborhood: f.hood.value, where_status: $('[name=where]:checked').value, interests: interests, photos: draft.photos };
      var btn = $('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
      var r = await sb.from('profiles').update(upd).eq('id', me.id).select().single();
      if (r.error) { btn.disabled = false; btn.textContent = 'Save'; $('#err').textContent = r.error.message; return; }
      profile = r.data; profileCache[profile.id] = profile; draft = {}; toast('saved.'); go('#/me');
    };
  }

  function viewSoon(tab, title, text) {
    setChrome(tab);
    app.innerHTML = top() + '<div class="soon stack"><h1 class="h2">' + esc(title) + '</h1><p class="lede">' + esc(text) + '</p></div>';
  }

  // ---------- start ----------
  var booted = false;
  sb.auth.onAuthStateChange(function (event) {
    if (booted && event === 'SIGNED_IN' && !me) { loadMe().then(route); }
    if (event === 'SIGNED_OUT') { me = null; profile = null; }
  });
  window.addEventListener('hashchange', route);
  loading();
  loadMe().then(function () {
    if (/access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
    booted = true;
    route();
  });
})();
