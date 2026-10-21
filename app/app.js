/* Moments, round 1: sign up, profiles, notes, join, group chats.
   Screens follow the Moments app layout (claude.ai artifact BYQqyLg8cDME8WxEv6Uoc4). */
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
    ['Be kind', 'Everyone here is looking for friends. Be the girl you\'d want to meet.'],
    ['Meet in public places', 'First meetups happen somewhere public. Share your plans with a friend.'],
    ['Show up or cancel', 'If you join a plan and can\'t make it, leave it so someone else can go.'],
    ['No selling or spam', 'This is for friendship, not promos or dating.'],
    ['Report anything off', 'Tap Report on any profile or note. We review every report.']
  ];
  var STEPS = 5;

  var app = document.getElementById('app');
  var tabs = document.getElementById('tabs');
  var me = null, profile = null, profileCache = {}, chatChannel = null, draft = {};

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || app).querySelectorAll(sel)); }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function avatar(p, px) {
    var st = 'width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.4) + 'px';
    if (p && p.photos && p.photos[0]) return '<img class="avatar" style="' + st + '" src="' + esc(p.photos[0]) + '" alt="">';
    return '<span class="avatar" style="' + st + '">' + esc(((p && p.first_name) || '').charAt(0).toUpperCase()) + '</span>';
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'now';
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
  function place(p) {
    if (!p) return '';
    if (p.where_status === 'traveling') return 'visiting Miami';
    if (p.where_status === 'moving here soon') return 'moving to ' + p.neighborhood;
    return p.neighborhood;
  }
  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    reply: '<path d="M4 5h16v11H9l-5 4z"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>'
  };
  function icon(n) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; }
  function backBar(href, title, right) {
    return '<header class="bar"><a class="icon-btn" href="' + href + '" aria-label="Back">' + icon('back') + '</a>' +
      '<b class="clip" style="flex:1;font-size:16px">' + esc(title || '') + '</b>' + (right || '') + '</header>';
  }
  function setChrome(tab) {
    tabs.hidden = !tab;
    document.body.classList.toggle('bare', !tab);
    $$('a', tabs).forEach(function (a) { a.classList.toggle('on', a.dataset.tab === tab); });
  }
  function loading(tab) { setChrome(tab || null); app.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>'; }
  function stopChat() { if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; } }
  function soon(what) { toast(what + ' are coming soon.'); }
  function shareNote(id) {
    var url = location.origin + location.pathname + '#/note/' + id;
    if (navigator.share) navigator.share({ title: 'a plan on moments', url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('link copied.'); });
  }

  async function getProfiles(ids) {
    var need = ids.filter(function (id, i) { return id && !profileCache[id] && ids.indexOf(id) === i; });
    if (need.length) {
      var r = await sb.from('profiles').select('*').in('id', need);
      (r.data || []).forEach(function (p) { profileCache[p.id] = p; });
    }
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
    // remember a shared link (community, event, plan) so new people land there after sign up
    if ((!me || !profile || !profile.rules_accepted_at) && /^(c|e|note)$/.test(parts[0] || '')) { try { localStorage.setItem('moments_next', '#' + h); } catch (e) {} }
    if (!me) return viewWelcome();
    if (!profile || !profile.rules_accepted_at) return viewOnboarding(parts[0] === 'join' ? Number(parts[1]) || 1 : 1);
    var next = null; try { next = localStorage.getItem('moments_next'); localStorage.removeItem('moments_next'); } catch (e) {}
    if (next && next !== '#' + h) return go(next);
    switch (parts[0]) {
      case 'new': return viewNewNote(parts[1]);
      case 'e': return viewEvent(parts[1]);
      case 'note': return viewNote(parts[1]);
      case 'chat': return viewChat(parts[1]);
      case 'chats': return viewChats();
      case 'me': return viewAccount();
      case 'edit': return viewEdit();
      case 'u': return parts[1] === me.id ? go('#/me') : viewProfile(parts[1]);
      case 'communities': return viewCommunities();
      case 'c': return parts[2] === 'chat' ? viewCommunityChat(parts[1]) : parts[2] === 'request' ? viewRequest(parts[1]) : viewCommunity(parts[1]);
      case 'pitch': return viewPitch();
      case 'discover': return viewDiscover();
      default: return viewHome();
    }
  }

  // ---------- welcome + sign in ----------
  function viewWelcome(sentTo) {
    setChrome(null);
    var bottom = sentTo
      ? '<div style="display:flex;flex-direction:column;gap:10px"><h1 style="font-size:38px">check your email.</h1>' +
        '<span class="sub">We sent a sign-in link to <b style="color:#fff">' + esc(sentTo) + '</b>. Open it on this phone and you\'ll land back here, signed in.</span>' +
        '<span class="sub" style="font-size:14px">Nothing there? Check spam or wait a minute.</span></div>' +
        '<button class="btn big" style="border:1px solid #4A4546;color:#fff;background:transparent" data-again>Use a different email</button>'
      : '<div style="display:flex;flex-direction:column;gap:10px"><h1>create moments,<br>find your people.</h1><span class="sub">Plans, communities and new friends in Miami.</span></div>' +
        '<form style="display:flex;flex-direction:column;gap:10px" novalidate>' +
        '<label for="email" style="position:absolute;width:1px;height:1px;overflow:hidden">Email</label>' +
        '<input class="dark-input" id="email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="your email">' +
        '<p class="error" id="err"></p>' +
        '<button class="btn white big" type="submit">Continue with email</button>' +
        '<span class="sub" style="text-align:center;font-size:14px">No password. We\'ll email you a link to sign in.</span></form>';
    app.innerHTML = '<div class="welcome"><div class="wordmark">moments<span>.</span></div><div style="display:flex;flex-direction:column;gap:22px">' + bottom + '</div></div>';
    if (sentTo) { $('[data-again]').onclick = function () { viewWelcome(); }; return; }
    $('form').onsubmit = async function (e) {
      e.preventDefault();
      var email = this.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#err').textContent = 'Enter a valid email.'; return; }
      var btn = $('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Continue with email';
        $('#err').textContent = /rate|limit|seconds/i.test(r.error.message) ? 'Too many tries. Wait a minute and try again.' : r.error.message;
        return;
      }
      viewWelcome(email);
    };
  }

  // ---------- sign-up steps ----------
  function stepFrame(step, title, sub, inner, cta) {
    return '<div class="step-top">' +
      (step > 1 ? '<a class="icon-btn" href="#/join/' + (step - 1) + '" aria-label="Back">' + icon('back') + '</a>' : '<span style="width:44px"></span>') +
      '<span class="track"><span style="width:' + Math.round(step / STEPS * 100) + '%"></span></span></div>' +
      '<div class="step-body"><div class="step-title"><b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + inner + '</div>' +
      '<div class="step-foot"><div><p class="error" id="err"></p><button class="btn black big" data-next>' + (cta || 'Continue') + '</button></div></div>';
  }
  function choiceList(name, items, picked, type, label) {
    return items.map(function (v) {
      var on = Array.isArray(picked) ? picked.indexOf(v) > -1 : picked === v;
      return '<label class="choice"><input type="' + (type || 'radio') + '" name="' + name + '" value="' + esc(v) + '"' + (on ? ' checked' : '') + '>' + esc(label ? label(v) : v) + '</label>';
    }).join('');
  }
  function whereLabel(w) { return w === 'traveling' ? 'I\'m traveling' : w === 'moving here soon' ? 'Moving here soon' : 'I live here'; }

  function viewOnboarding(step) {
    setChrome(null);
    if (profile && !draft.first_name) draft = { first_name: profile.first_name, age_range: profile.age_range, bio: profile.bio, neighborhood: profile.neighborhood, where_status: profile.where_status, interests: profile.interests, photos: profile.photos };
    draft.photos = draft.photos || []; draft.interests = draft.interests || [];
    if (step > 1 && !draft.first_name) step = 1;
    var err = function (m) { $('#err').textContent = m; };

    if (step === 1) {
      app.innerHTML = stepFrame(1, 'The basics', 'This is how other girls will see you.',
        '<div class="field"><label class="lab" for="fn">First name</label><input class="input" id="fn" maxlength="40" autocomplete="given-name" value="' + esc(draft.first_name || '') + '"></div>' +
        '<div class="field"><span class="lab">Age</span><div class="choices">' + choiceList('age', AGES, draft.age_range) + '</div><span class="hint">You must be 21 or older.</span></div>' +
        '<div class="field"><label class="lab" for="bio">Short bio <i>(optional)</i></label><textarea class="input" id="bio" rows="3" maxlength="300" placeholder="new in miami, love pilates, matcha and wine nights">' + esc(draft.bio || '') + '</textarea></div>' +
        '');
      $('[data-next]').onclick = function () {
        var name = $('#fn').value.trim(), age = ($('[name=age]:checked') || {}).value;
        if (!name) return err('Add your first name.');
        if (!age) return err('Pick your age.');
        draft.first_name = name; draft.age_range = age; draft.bio = $('#bio').value.trim(); go('#/join/2');
      };
    } else if (step === 2) {
      app.innerHTML = stepFrame(2, 'Add your photos', 'At least one where your face is clear. The first one is your profile photo.', '<div class="photo-grid" id="slots"></div>');
      renderSlots();
      $('[data-next]').onclick = function () { if (!draft.photos.length) return err('Add at least one photo.'); go('#/join/3'); };
    } else if (step === 3) {
      app.innerHTML = stepFrame(3, 'Where are you?', 'So we can show you plans and girls nearby.',
        '<div class="field"><span class="lab">Right now</span><div class="choices">' + choiceList('where', WHERE, draft.where_status || 'live here', 'radio', whereLabel) + '</div></div>' +
        '<div class="field"><label class="lab" for="hood">Neighborhood</label><select class="input" id="hood"><option value="">Choose one</option>' + HOODS.map(function (n) { return '<option' + (draft.neighborhood === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select><span class="hint">Traveling? Pick where you\'re staying.</span></div>');
      $('[data-next]').onclick = function () {
        if (!$('#hood').value) return err('Pick your neighborhood.');
        draft.neighborhood = $('#hood').value; draft.where_status = $('[name=where]:checked').value; go('#/join/4');
      };
    } else if (step === 4) {
      app.innerHTML = stepFrame(4, 'Your favorite moments', 'Pick as many as you like. We\'ll show you plans you\'ll love.',
        '<div class="choices">' + choiceList('m', MOMENTS, draft.interests, 'checkbox') + '</div>');
      $('[data-next]').onclick = function () {
        var picked = $$('[name=m]:checked').map(function (i) { return i.value; });
        if (!picked.length) return err('Pick at least one.');
        draft.interests = picked; go('#/join/5');
      };
    } else {
      app.innerHTML = stepFrame(5, 'House rules', 'A few things every member agrees to.',
        RULES.map(function (r, i) { return '<div class="rule"><span class="n">' + (i + 1) + '</span><span style="display:flex;flex-direction:column;gap:2px"><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></span></div>'; }).join(''),
        'I agree, let\'s go');
      $('[data-next]').onclick = async function () {
        var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
        var row = { id: me.id, first_name: draft.first_name, age_range: draft.age_range, bio: draft.bio || null, neighborhood: draft.neighborhood, where_status: draft.where_status || 'live here', interests: draft.interests, photos: draft.photos, rules_accepted_at: new Date().toISOString() };
        var r = await sb.from('profiles').upsert(row).select().single();
        if (r.error) { btn.disabled = false; btn.textContent = 'I agree, let\'s go'; err(r.error.message); return; }
        profile = r.data; profileCache[profile.id] = profile; draft = {};
        location.hash = '#/'; toast('welcome to moments, ' + profile.first_name + '.');
      };
    }
  }

  function renderSlots() {
    var box = $('#slots'), html = '';
    for (var i = 0; i < 3; i++) {
      var url = draft.photos[i];
      html += url
        ? '<div class="photo-slot"><img src="' + esc(url) + '" alt="Your photo ' + (i + 1) + '"><button class="x" data-rm="' + i + '" aria-label="Remove photo">✕</button>' + (i === 0 ? '<span class="first">Main</span>' : '') + '</div>'
        : '<label class="photo-slot" aria-label="Add a photo">+<input type="file" accept="image/*"></label>';
    }
    box.innerHTML = html;
    $$('[data-rm]', box).forEach(function (b) { b.onclick = function (e) { e.preventDefault(); draft.photos.splice(Number(b.dataset.rm), 1); renderSlots(); }; });
    $$('input[type=file]', box).forEach(function (inp) {
      inp.onchange = async function () {
        var f = inp.files[0]; if (!f) return;
        inp.parentNode.innerHTML = '<div class="spinner" style="margin:0"></div>';
        try { draft.photos.push(await uploadPhoto(f)); } catch (e) { toast('That photo didn\'t upload. Try another.'); }
        renderSlots();
      };
    });
  }
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
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

  // ---------- home ----------
  function noteState(n) {
    var members = (n.note_members || []).map(function (m) { return m.user_id; });
    var guests = members.filter(function (u) { return u !== n.author_id; });
    return { members: members, guests: guests, left: Math.max(0, n.spots - guests.length), joined: members.indexOf(me.id) > -1, mine: n.author_id === me.id };
  }
  function spotBar(n, grey) {
    var st = noteState(n);
    var faces = st.members.slice(0, 3).map(function (u) { return avatar(profileCache[u], 24); }).join('');
    var btn = st.mine ? '<a class="btn black pill" href="#/chat/' + n.id + '">Chat</a>'
      : st.joined ? '<a class="btn outline pill" href="#/chat/' + n.id + '">Joined</a>'
      : st.left ? '<button class="btn black pill" data-join="' + n.id + '">Join</button>'
      : '<button class="btn outline pill" disabled>Full</button>';
    return '<div class="spotbar' + (grey ? ' grey' : '') + '"><div class="faces">' + faces + '<span class="spots-txt" style="margin-left:8px">' + (st.left ? st.left + ' of ' + n.spots + ' spots left' : 'Full') + '</span></div>' + btn + '</div>';
  }
  function post(n) {
    var a = profileCache[n.author_id] || {};
    var traveling = a.where_status === 'traveling';
    return '<article class="post">' +
      '<div class="post-head"><a href="#/u/' + n.author_id + '">' + avatar(a, 44) + '</a><div style="display:flex;flex-direction:column;gap:2px;min-width:0">' +
      '<a class="post-name" href="#/u/' + n.author_id + '">' + esc(a.first_name || 'someone') + '</a>' +
      '<span class="post-meta">' + esc([a.age_range, traveling ? null : a.neighborhood, ago(n.created_at)].filter(Boolean).join(' · ')) + '</span>' +
      (traveling ? '<span class="badge wine" style="align-self:flex-start;font-size:11px;padding:2px 8px">✈ Visiting Miami</span>' : '') + '</div></div>' +
      '<a class="post-body" href="#/note/' + n.id + '">' + esc(n.body) + '</a>' +
      (n.event_id ? eventCard(eventCache[n.event_id]) : '') +
      ((n.place || n.starts_at) ? '<div class="post-where">' + (n.place ? '<span>' + esc(n.place) + '</span>' : '') + (n.starts_at ? '<span>' + esc(when(n.starts_at)) + '</span>' : '') + '</div>' : '') +
      spotBar(n) +
      '<div class="actions"><button data-soon="Likes" aria-label="Like">' + icon('heart') + '</button><a href="#/note/' + n.id + '" aria-label="Open" style="display:flex">' + icon('reply') + '</a><button data-soon="Saves" aria-label="Save">' + icon('save') + '</button><button data-share="' + n.id + '" aria-label="Share">' + icon('share') + '</button></div>' +
      '</article>';
  }
  function bindPosts() {
    $$('[data-soon]').forEach(function (b) { b.onclick = function () { soon(b.dataset.soon); }; });
    $$('[data-share]').forEach(function (b) { b.onclick = function () { shareNote(b.dataset.share); }; });
    $$('[data-join]').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Joining…';
        var r = await sb.rpc('join_note', { p_note: b.dataset.join });
        if (r.error) { b.disabled = false; b.textContent = 'Join'; toast('Couldn\'t join. Try again.'); return; }
        if (r.data === 'full') { toast('That plan just filled up.'); route(); return; }
        go('#/chat/' + b.dataset.join + '/joined');
      };
    });
  }
  async function viewHome() {
    loading('home');
    var r = await sb.from('notes').select('*, note_members(user_id)').order('created_at', { ascending: false }).limit(60);
    var notes = r.data || [];
    var ids = []; notes.forEach(function (n) { ids.push(n.author_id); (n.note_members || []).forEach(function (m) { ids.push(m.user_id); }); });
    await getProfiles(ids);
    await getEvents(notes.map(function (n) { return n.event_id; }));
    app.innerHTML = '<header class="home-head"><div class="wordmark">moments<span>.</span></div><div class="head-pill">' +
      '<button class="icon-btn" data-soon="Notifications" aria-label="Notifications">' + icon('bell') + '</button>' +
      '<a class="icon-btn" href="#/me" aria-label="Your account">' + avatar(profile, 32) + '</a></div></header>' +
      (r.error ? '<p class="empty">Couldn\'t load plans. Check your connection.</p>' : notes.length ? notes.map(post).join('') : '<div class="post"><p class="empty" style="padding:32px 8px">No plans yet.<br>Tap + to post the first one.</p></div>') +
      '<a class="fab" href="#/new" aria-label="Post a plan">' + icon('plus') + '</a>';
    bindPosts();
  }

  // ---------- new note ----------
  async function viewNewNote(eventId) {
    if (eventId) await getEvents([eventId]);
    var ev = eventId ? eventCache[eventId] : null;
    setChrome(null);
    var spots = 4;
    app.innerHTML = '<header class="bar plain"><a class="txt" href="#/">Cancel</a><div class="mid">New note</div><button class="btn black" style="font-size:15px;padding:8px 16px" data-post>Post</button></header>' +
      '<div class="compose">' +
      '<div style="display:flex;gap:10px">' + avatar(profile, 38) + '<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0"><b style="font-size:14px">You</b>' +
      '<label for="note" style="font-size:12px;color:var(--grey2)">Write what, when and where</label>' +
      '<textarea class="input" id="note" rows="4" maxlength="500" placeholder="anyone wanna go for a walk and matcha tomorrow? 9am, brickell">' + (ev ? esc('anyone going to ' + ev.title.toLowerCase() + ' with me?') : '') + '</textarea></div></div>' +
      (ev ? eventCard(ev) : '<a class="boxrow" href="#/discover" style="border-style:dashed"><span style="display:flex;flex-direction:column;gap:2px"><b>Attach an event</b><span class="hint">Optional · reshare something from Discover</span></span><span style="font-size:18px;color:var(--grey3)">›</span></a>') +
      '<div class="boxrow"><label for="place" style="font-size:15px;font-weight:700;white-space:nowrap">Where</label><input class="plain-input" id="place" maxlength="120" placeholder="optional" style="text-align:right"></div>' +
      '<div class="boxrow"><label for="when" style="font-size:15px;font-weight:700;white-space:nowrap">When</label><input class="plain-input" id="when" type="datetime-local" style="text-align:right"></div>' +
      '<div class="boxrow"><div style="display:flex;flex-direction:column;gap:2px"><b>Spots</b><span class="hint">How many people can join you</span></div>' +
      '<div class="stepper"><button data-d="-1" aria-label="Fewer spots">−</button><b id="spots" style="font-size:18px;min-width:20px;text-align:center">' + spots + '</b><button data-d="1" aria-label="More spots">+</button></div></div>' +
      '<div class="info">When someone taps <b>Join</b>, they go straight into a group chat with you and everyone else who joined. When all spots are taken, your note shows <b>Full</b>.</div>' +
      '<p class="error" id="err"></p></div>';
    $$('[data-d]').forEach(function (b) { b.onclick = function () { spots = Math.min(20, Math.max(1, spots + Number(b.dataset.d))); $('#spots').textContent = spots; }; });
    $('#note').focus();
    $('[data-post]').onclick = async function () {
      var body = $('#note').value.trim();
      if (!body) { $('#err').textContent = 'Write what the plan is.'; return; }
      var w = $('#when').value;
      var btn = this; btn.disabled = true; btn.textContent = 'Posting…';
      var r = await sb.from('notes').insert({ author_id: me.id, event_id: ev ? ev.id : null, body: body, place: $('#place').value.trim() || null, starts_at: w ? new Date(w).toISOString() : null, spots: spots }).select().single();
      if (r.error) { btn.disabled = false; btn.textContent = 'Post'; $('#err').textContent = r.error.message; return; }
      toast('your note is up.'); go('#/');
    };
  }

  // ---------- note detail ----------
  async function viewNote(id) {
    loading();
    var r = await sb.from('notes').select('*, note_members(user_id)').eq('id', id).maybeSingle();
    if (!r.data) { app.innerHTML = backBar('#/', 'Note') + '<p class="empty">This plan was removed.</p>'; return; }
    var n = r.data, st = noteState(n), a;
    await getProfiles([n.author_id].concat(st.members));
    await getEvents([n.event_id]);
    a = profileCache[n.author_id] || {};
    var going = st.members.map(function (u) { return profileCache[u]; }).filter(Boolean);
    app.innerHTML = backBar('#/', 'Note', st.mine ? '' : '<button class="act" data-soon="Reports">··· Report</button>') +
      '<article class="card-white">' +
      '<a class="person" href="#/u/' + n.author_id + '">' + avatar(a, 40) + '<span style="font-size:14px"><b>' + esc(a.first_name || '') + '</b> <span class="muted">· ' + esc([a.age_range, place(a), ago(n.created_at)].join(' · ')) + '</span></span></a>' +
      '<p style="margin:0;font-size:16px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere">' + esc(n.body) + '</p>' +
      (n.event_id ? eventCard(eventCache[n.event_id]) : '') +
      ((n.place || n.starts_at) ? '<div class="post-where" style="margin:0">' + (n.place ? '<span>' + esc(n.place) + '</span>' : '') + (n.starts_at ? '<span>' + esc(when(n.starts_at)) + '</span>' : '') + '</div>' : '') +
      spotBar(n, true) +
      '<div class="text-actions"><button data-soon="Likes">♡ Like</button><button data-soon="Saves">Save</button><button data-share="' + n.id + '">Share</button></div></article>' +
      '<section class="section"><b>Who\'s going</b>' +
      going.map(function (p) { return '<a class="person" href="#/u/' + p.id + '">' + avatar(p, 32) + '<span style="font-size:14px"><b>' + esc(p.first_name) + '</b> <span class="muted">· ' + (p.id === n.author_id ? 'host · ' : '') + esc(p.age_range + ' · ' + place(p)) + '</span></span></a>'; }).join('') +
      (st.joined && !st.mine ? '<button class="btn outline big" style="margin-top:12px" data-leave>Leave this plan</button>' : '') +
      (st.mine ? '<button class="btn outline big" style="margin-top:12px" data-del>Delete this note</button>' : '') + '</section>';
    bindPosts();
    if ($('[data-leave]')) $('[data-leave]').onclick = async function () {
      if (!confirm('Leave this plan? Your spot opens up for someone else.')) return;
      await sb.from('note_members').delete().eq('note_id', id).eq('user_id', me.id); toast('you left the plan.'); route();
    };
    if ($('[data-del]')) $('[data-del]').onclick = async function () {
      if (!confirm('Delete this note and its group chat for everyone?')) return;
      var d = await sb.from('notes').delete().eq('id', id);
      if (d.error) return toast('Couldn\'t delete. Try again.');
      toast('note deleted.'); go('#/');
    };
  }

  // ---------- chats ----------
  async function viewChats() {
    loading('chats');
    var r = await sb.from('note_members').select('note_id, notes(id, body, author_id, created_at, starts_at)').eq('user_id', me.id);
    var rows = (r.data || []).filter(function (x) { return x.notes; });
    var ids = rows.map(function (x) { return x.note_id; }), last = {};
    if (ids.length) {
      var m = await sb.from('messages').select('note_id, body, user_id, created_at').in('note_id', ids).order('created_at', { ascending: false }).limit(300);
      (m.data || []).forEach(function (x) { if (!last[x.note_id]) last[x.note_id] = x; });
    }
    rows.sort(function (a, b) { return new Date((last[b.note_id] || b.notes).created_at) - new Date((last[a.note_id] || a.notes).created_at); });
    var pids = []; rows.forEach(function (x) { pids.push(x.notes.author_id); if (last[x.note_id]) pids.push(last[x.note_id].user_id); });
    await getProfiles(pids);
    app.innerHTML = '<header class="bar plain"><div class="title">Chat</div></header>' +
      '<div class="sec-label">PLANS</div>' +
      (rows.length ? rows.map(function (x) {
        var a = profileCache[x.notes.author_id] || {}, l = last[x.note_id], lp = l ? profileCache[l.user_id] : null;
        return '<a class="chat-row" href="#/chat/' + x.note_id + '">' + avatar(a, 50) +
          '<span class="t"><b class="clip">' + esc(x.notes.body) + '</b><span class="clip">' + (l ? esc((l.user_id === me.id ? 'You' : (lp ? lp.first_name : '')) + ': ' + l.body) : 'No messages yet') + '</span></span>' +
          '<span class="when">' + ago((l || x.notes).created_at) + '</span></a>';
      }).join('') : '<p class="empty">Join a plan and its group chat shows up here.</p>') +
      '<div class="sec-label">COMMUNITIES</div><div id="cchats"><p class="empty" style="padding:16px 24px">Loading…</p></div>';
    var comms = (await loadCommunities()).filter(function (c) { return c.state === 'member' || c.state === 'host'; });
    var cl = {};
    if (comms.length) {
      var cm = await sb.from('community_messages').select('community_id, body, user_id, sender_name, created_at').in('community_id', comms.map(function (c) { return c.id; })).order('created_at', { ascending: false }).limit(300);
      (cm.data || []).forEach(function (x) { if (!cl[x.community_id]) cl[x.community_id] = x; });
      await getProfiles(Object.keys(cl).map(function (k) { return cl[k].user_id; }).filter(Boolean));
    }
    $('#cchats').innerHTML = comms.length ? comms.map(function (c) {
      var l = cl[c.id], who = l ? (l.user_id === me.id ? 'You' : l.user_id ? (profileCache[l.user_id] || {}).first_name : l.sender_name) : '';
      return '<a class="chat-row" href="#/c/' + c.slug + '/chat"><img src="' + esc(c.cover_url) + '" alt="" style="width:50px;height:50px;border-radius:12px;object-fit:cover;flex-shrink:0">' +
        '<span class="t"><b class="clip">' + esc(c.name) + '</b><span class="clip">' + (l ? esc(who + ': ' + l.body) : 'No messages yet') + '</span></span><span class="when">' + (l ? ago(l.created_at) : '') + '</span></a>';
    }).join('') : '<p class="empty" style="padding:16px 24px">Join a community and its chat shows up here.</p>';
  }

  async function viewChat(id, justJoined) {
    setChrome(null); loading();
    var n = await sb.from('notes').select('*, note_members(user_id)').eq('id', id).maybeSingle();
    if (!n.data) { app.innerHTML = backBar('#/chats', '') + '<p class="empty">This plan was removed.</p>'; return; }
    var note = n.data, st = noteState(note);
    if (!st.joined) { go('#/note/' + id); return; }
    await getProfiles(st.members);
    var r = await sb.from('messages').select('*').eq('note_id', id).order('created_at').limit(500);
    var msgs = r.data || [];
    var going = st.members.map(function (u) { return profileCache[u]; }).filter(Boolean);
    app.innerHTML = '<header class="bar"><a class="icon-btn" href="#/chats" aria-label="Back">' + icon('back') + '</a>' +
      '<a href="#/note/' + id + '" style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0"><b class="clip" style="font-size:16px">' + esc(note.body) + '</b><span style="font-size:12px;color:var(--grey2)">' + st.guests.length + ' of ' + note.spots + ' joined · group chat</span></a>' +
      (st.mine ? '' : '<button class="btn outline" style="font-size:12px;padding:6px 12px;color:var(--grey)" data-leave-chat>Leave</button>') + '</header>' +
      '<div class="pinned"><span class="k">PINNED NOTE</span><span style="font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere">' + esc(note.body) + '</span>' +
      '<div style="display:flex;align-items:center;gap:6px"><div class="faces">' + going.slice(0, 4).map(function (p) { return avatar(p, 24); }).join('') + '</div>' +
      '<span style="font-size:12px;color:var(--grey2)">' + esc(going.map(function (p) { return p.id === me.id ? 'you' : p.first_name; }).join(', ')) + ' · ' + (st.left ? st.left + ' spots left' : 'full') + '</span></div></div>' +
      '<div class="thread" id="thread"></div>' +
      '<div class="composer"><form><label for="msg" style="position:absolute;width:1px;height:1px;overflow:hidden">Message</label><input id="msg" name="body" maxlength="1000" placeholder="Message the group" autocomplete="off"><button class="send" aria-label="Send">' + icon('send') + '</button></form></div>';
    var box = $('#thread'), seen = {};
    if (justJoined) box.innerHTML = '<span class="sys">You joined · ' + st.guests.length + ' of ' + note.spots + ' spots filled</span>';
    else if (!msgs.length) box.innerHTML = '<span class="sys">Say hi and pick a spot to meet</span>';
    function add(m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      var el = document.createElement('div');
      if (m.user_id === me.id) { el.className = 'mine'; el.textContent = m.body; }
      else {
        var p = profileCache[m.user_id] || {};
        el.className = 'msg';
        el.innerHTML = avatar(p, 28) + '<div style="display:flex;flex-direction:column;gap:3px"><span class="who">' + esc(p.first_name || '') + (m.user_id === note.author_id ? ' · host' : '') + '</span><span class="bub">' + esc(m.body) + '</span></div>';
      }
      box.appendChild(el);
    }
    msgs.forEach(add);
    window.scrollTo(0, document.body.scrollHeight);
    if ($('[data-leave-chat]')) $('[data-leave-chat]').onclick = async function () {
      if (!confirm('Leave this plan and its chat? Your spot opens up for someone else.')) return;
      await sb.from('note_members').delete().eq('note_id', id).eq('user_id', me.id); toast('you left the plan.'); go('#/chats');
    };
    chatChannel = sb.channel('chat-' + id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'note_id=eq.' + id }, async function (payload) {
      await getProfiles([payload.new.user_id]); add(payload.new); window.scrollTo(0, document.body.scrollHeight);
    }).subscribe();
    $('.composer form').onsubmit = async function (e) {
      e.preventDefault();
      var body = this.body.value.trim(); if (!body) return;
      this.body.value = '';
      var ins = await sb.from('messages').insert({ note_id: id, user_id: me.id, body: body }).select().single();
      if (ins.error) { toast('Didn\'t send. Try again.'); this.body.value = body; return; }
      add(ins.data); window.scrollTo(0, document.body.scrollHeight);
    };
  }

  // ---------- account + profiles ----------
  async function viewAccount() {
    loading('me');
    var r = await sb.from('notes').select('*, note_members(user_id)').eq('author_id', me.id).order('created_at', { ascending: false });
    var mine = r.data || [], p = profile;
    app.innerHTML = '<header class="bar"><div class="title">Account</div></header>' +
      '<div class="me-block"><div class="me-row">' + avatar(p, 76) + '<div class="t"><b>' + esc(p.first_name) + '</b><span style="font-size:13px;color:var(--grey)">' + esc(p.age_range + ' · ' + place(p)) + '</span>' +
      (p.where_status === 'traveling' ? '<div class="chips"><span class="badge wine">✈ Visiting Miami</span></div>' : '') + '</div></div>' +
      (p.bio ? '<p style="margin:0;font-size:14px;color:var(--ink2);line-height:1.4">' + esc(p.bio) + '</p>' : '') +
      (p.interests.length ? '<div class="chips">' + p.interests.map(function (i) { return '<span class="tag">' + esc(i) + '</span>'; }).join('') + '</div>' : '') +
      '<a class="btn outline" style="font-size:14px;padding:9px" href="#/edit">Edit profile</a></div>' +
      '<section class="section"><b>Your notes</b>' +
      (mine.length ? mine.map(function (n) { var st = noteState(n); return '<a class="list-card" href="#/note/' + n.id + '"><span class="clip" style="flex:1">' + esc(n.body) + ' <span class="muted">· ' + (st.left ? st.left + ' of ' + n.spots + ' left' : 'full') + '</span></span><span style="color:var(--grey);white-space:nowrap">Manage ›</span></a>'; }).join('') : '<p class="muted" style="margin:0;font-size:14px">You haven\'t posted a note yet.</p>') +
      '</section>' +
      '<section class="section"><b>Your communities</b><div id="mycomms"></div></section>' +
      '<section class="section"><b>Saved</b><div id="mysaved" style="display:flex;flex-direction:column;gap:8px"></div></section>' +
      '<button class="signout" data-out>Sign out</button>';
    $('[data-out]').onclick = async function () { await sb.auth.signOut(); me = null; profile = null; profileCache = {}; go('#/'); };
    var comms = (await loadCommunities()).filter(function (c) { return c.state === 'member' || c.state === 'host'; });
    var sv = await sb.from('event_saves').select('event_id, events(*)').eq('user_id', me.id).order('created_at', { ascending: false });
    var sbx = $('#mysaved');
    if (sbx) sbx.innerHTML = (sv.data || []).filter(function (x) { return x.events; }).map(function (x) { var e = x.events; return '<a class="list-card" style="gap:10px;justify-content:flex-start;padding:8px" href="#/e/' + e.id + '"><img src="' + esc(e.image_url) + '" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0"><span style="display:flex;flex-direction:column;gap:2px"><b>' + esc(e.title) + '</b><span class="muted">Event · ' + esc(evWhen(e)) + '</span></span></a>'; }).join('') || '<p class="muted" style="margin:0;font-size:14px">Save events from Discover and they show up here.</p>';
    var box = $('#mycomms'); if (!box) return;
    box.innerHTML = comms.length ? '<div class="comm-grid">' + comms.map(function (c) { return '<a href="#/c/' + c.slug + '"><img src="' + esc(c.cover_url) + '" alt=""><b>' + esc(c.name) + '</b></a>'; }).join('') + '</div>'
      : '<a class="list-card" href="#/communities"><span>Find communities to join</span><span style="color:var(--grey)">›</span></a>';
  }

  async function viewProfile(id) {
    loading();
    await getProfiles([id]);
    var p = profileCache[id];
    if (!p) { app.innerHTML = backBar('#/', '') + '<p class="empty">Profile not found.</p>'; return; }
    var r = await sb.from('notes').select('*, note_members(user_id)').eq('author_id', id).order('created_at', { ascending: false }).limit(10);
    var notes = r.data || [];
    app.innerHTML = '<header class="bar" style="border:0;justify-content:space-between"><a class="icon-btn" href="javascript:history.back()" aria-label="Back">' + icon('back') + '</a>' +
      '<div style="display:flex;gap:4px"><button class="act" data-soon="Blocking">Block</button><button class="act" data-soon="Reports">Report</button></div></header>' +
      '<div class="prof-top">' + avatar(p, 110) + '<b>' + esc(p.first_name) + '</b><span style="font-size:14px;color:var(--grey)">' + esc(p.age_range + ' · ' + place(p)) + '</span>' +
      (p.where_status === 'traveling' ? '<div class="chips"><span class="badge line">✈ Visiting Miami</span></div>' : '') +
      (p.bio ? '<p style="margin:0;font-size:14px;color:var(--ink2);line-height:1.4">' + esc(p.bio) + '</p>' : '') + '</div>' +
      '<div class="section" style="gap:16px">' +
      (p.photos.length > 1 ? '<div class="sq-grid">' + p.photos.slice(1).map(function (u) { return '<img src="' + esc(u) + '" alt="">'; }).join('') + '</div>' : '') +
      (p.interests.length ? '<section style="display:flex;flex-direction:column;gap:8px"><b style="font-size:15px">Interests</b><div class="chips">' + p.interests.map(function (i) { return '<span class="tag white">' + esc(i) + '</span>'; }).join('') + '</div></section>' : '') +
      (p.instagram ? '<a style="font-size:14px;color:var(--grey)" href="https://instagram.com/' + encodeURIComponent(p.instagram) + '" target="_blank" rel="noopener">@' + esc(p.instagram) + ' on Instagram</a>' : '') +
      '<section style="display:flex;flex-direction:column;gap:8px"><b style="font-size:15px">Her notes</b>' +
      (notes.length ? notes.map(function (n) { var st = noteState(n); return '<a class="list-card" style="font-size:14px" href="#/note/' + n.id + '"><span>' + esc(n.body) + ' <span class="muted" style="font-size:12px">· ' + (st.left ? st.left + ' of ' + n.spots + ' left' : 'full') + '</span></span></a>'; }).join('') : '<p class="muted" style="margin:0;font-size:14px">No notes yet.</p>') +
      '</section></div>';
    bindPosts();
  }

  function viewEdit() {
    setChrome(null);
    draft = { photos: profile.photos.slice() };
    var p = profile;
    app.innerHTML = '<header class="bar plain"><a class="txt" href="#/me">Cancel</a><div class="mid">Edit profile</div><button class="btn black" style="font-size:15px;padding:8px 16px" data-save>Save</button></header>' +
      '<div class="step-body" style="padding-bottom:60px">' +
      '<div class="field"><span class="lab">Photos</span><div class="photo-grid" id="slots"></div></div>' +
      '<div class="field"><label class="lab" for="fn">First name</label><input class="input" id="fn" maxlength="40" value="' + esc(p.first_name) + '"></div>' +
      '<div class="field"><label class="lab" for="bio">Short bio <i>(optional)</i></label><textarea class="input" id="bio" rows="3" maxlength="300">' + esc(p.bio || '') + '</textarea></div>' +
      '<div class="field"><label class="lab" for="ig">Instagram <i>(optional)</i></label><input class="input" id="ig" maxlength="30" placeholder="yourhandle" value="' + esc(p.instagram || '') + '"></div>' +
      '<div class="field"><span class="lab">Age</span><div class="choices">' + choiceList('age', AGES, p.age_range) + '</div></div>' +
      '<div class="field"><span class="lab">Right now</span><div class="choices">' + choiceList('where', WHERE, p.where_status, 'radio', whereLabel) + '</div></div>' +
      '<div class="field"><label class="lab" for="hood">Neighborhood</label><select class="input" id="hood">' + HOODS.map(function (n) { return '<option' + (p.neighborhood === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><span class="lab">Favorite moments</span><div class="choices">' + choiceList('m', MOMENTS, p.interests, 'checkbox') + '</div></div>' +
      '<p class="error" id="err"></p></div>';
    renderSlots();
    $('[data-save]').onclick = async function () {
      var name = $('#fn').value.trim();
      if (!name) { $('#err').textContent = 'Add your first name.'; return; }
      if (!draft.photos.length) { $('#err').textContent = 'Keep at least one photo.'; return; }
      var upd = { first_name: name, bio: $('#bio').value.trim() || null, instagram: $('#ig').value.trim().replace(/^@+/, '') || null, age_range: $('[name=age]:checked').value, neighborhood: $('#hood').value, where_status: $('[name=where]:checked').value, interests: $$('[name=m]:checked').map(function (i) { return i.value; }), photos: draft.photos };
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      var r = await sb.from('profiles').update(upd).eq('id', me.id).select().single();
      if (r.error) { btn.disabled = false; btn.textContent = 'Save'; $('#err').textContent = r.error.message; return; }
      profile = r.data; profileCache[profile.id] = profile; draft = {}; toast('saved.'); go('#/me');
    };
  }

  function viewSoon(tab, title, text) {
    setChrome(tab);
    app.innerHTML = '<header class="bar plain"><div class="title">' + esc(title) + '</div></header><div class="soon"><p>' + esc(text) + '</p></div>';
  }

  // ---------- communities ----------
  var COMM_COLS = 'id, slug, name, bio, cover_url, is_private, host_id, host_name, base_members, created_at';
  async function loadCommunities() {
    var c = await sb.from('communities').select(COMM_COLS).order('base_members', { ascending: false });
    var m = await sb.from('community_members').select('community_id, user_id, status');
    var list = c.data || [], mem = m.data || [];
    list.forEach(function (x) {
      var rows = mem.filter(function (r) { return r.community_id === x.id; });
      var mine = rows.filter(function (r) { return r.user_id === me.id; })[0];
      x.members = x.base_members + rows.filter(function (r) { return r.status === 'member'; }).length;
      x.state = x.host_id === me.id ? 'host' : mine ? mine.status : 'none';
    });
    return list;
  }
  function count(n) { return n.toLocaleString() + (n === 1 ? ' member' : ' members'); }
  function commBtn(c) {
    if (c.state === 'host') return '<span class="btn outline" style="font-size:13px;padding:7px 14px">Host</span>';
    if (c.state === 'member') return '<button class="btn outline" style="font-size:13px;padding:7px 14px" data-leave-c="' + c.id + '">Joined ✓</button>';
    if (c.state === 'requested') return '<span class="btn outline" style="font-size:13px;padding:7px 14px;color:var(--grey2)">Requested</span>';
    if (c.is_private) return '<a class="btn outline" style="font-size:13px;padding:7px 12px;border-color:var(--ink)" href="#/c/' + c.slug + '/request">Request</a>';
    return '<button class="btn black" style="font-size:13px;padding:8px 14px" data-join-c="' + c.id + '">Join</button>';
  }
  function bindCommBtns() {
    $$('[data-join-c]').forEach(function (b) {
      b.onclick = async function (e) {
        e.preventDefault(); b.disabled = true; b.textContent = 'Joining…';
        var r = await sb.rpc('join_community', { p_comm: b.dataset.joinC });
        if (r.error) { b.disabled = false; b.textContent = 'Join'; toast('Couldn\'t join. Try again.'); return; }
        toast('you\'re in. say hi in the chat.'); route();
      };
    });
    $$('[data-leave-c]').forEach(function (b) {
      b.onclick = async function (e) {
        e.preventDefault();
        if (!confirm('Leave this community and its chat? You can join again later.')) return;
        await sb.from('community_members').delete().eq('community_id', b.dataset.leaveC).eq('user_id', me.id);
        toast('you left the community.'); route();
      };
    });
  }
  function commRow(c, right) {
    return '<div class="comm-row"><a class="comm-link" href="#/c/' + c.slug + '"><img src="' + esc(c.cover_url) + '" alt="">' +
      '<span class="t"><b>' + esc(c.name) + '</b><span>' + count(c.members) + ' · ' + (c.is_private ? 'Private' : 'Public') + '</span></span></a>' + (right || '') + '</div>';
  }

  async function viewCommunities() {
    loading('communities');
    var list = await loadCommunities();
    var mine = list.filter(function (c) { return c.state === 'member' || c.state === 'host'; });
    var rest = list.filter(function (c) { return mine.indexOf(c) < 0; });
    app.innerHTML = '<header class="bar" style="flex-direction:column;align-items:stretch;gap:10px;padding-left:16px;padding-right:16px">' +
      '<div style="font-size:22px;font-weight:700">Communities</div>' +
      '<label for="csearch" style="position:absolute;width:1px;height:1px;overflow:hidden">Search communities</label>' +
      '<input id="csearch" class="search" placeholder="Search communities" autocomplete="off"></header>' +
      '<div id="clist" style="padding-top:14px;display:flex;flex-direction:column;gap:18px"></div>';
    function draw(q) {
      var f = function (c) { return !q || (c.name + ' ' + (c.bio || '')).toLowerCase().indexOf(q) > -1; };
      var pop = list.slice(0, 4).filter(f);
      $('#clist').innerHTML =
        (pop.length && !q ? '<section style="display:flex;flex-direction:column;gap:10px"><b style="font-size:16px;padding:0 16px">Popular communities</b><div class="pop-row">' +
          pop.map(function (c) { return '<a class="pop" href="#/c/' + c.slug + '" style="background-image:linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.6)),url(' + esc(c.cover_url) + ')"><b>' + esc(c.name) + '</b><span>' + count(c.members) + '</span></a>'; }).join('') + '</div></section>' : '') +
        (mine.filter(f).length ? '<section class="csec"><b>Your communities</b>' + mine.filter(f).map(function (c) { return commRow(c, c.state === 'host' ? '<span class="badge wine">Host</span>' : ''); }).join('') + '</section>' : '') +
        (rest.filter(f).length ? '<section class="csec"><b>Explore</b>' + rest.filter(f).map(function (c) { return commRow(c, commBtn(c)); }).join('') + '</section>' : '') +
        (q && !list.filter(f).length ? '<p class="empty">No communities match "' + esc(q) + '".</p>' : '') +
        '<a class="pitch-link" href="#/pitch"><span style="display:flex;flex-direction:column;gap:2px"><b style="font-size:14px">Have an idea for a community?</b><span style="font-size:12px;color:var(--grey2)">Tell us about it and we\'ll reach out</span></span><span style="font-size:18px;color:var(--grey3)">›</span></a>';
      bindCommBtns();
    }
    draw('');
    $('#csearch').oninput = function () { draw(this.value.trim().toLowerCase()); };
  }

  async function getCommunity(slug) {
    var list = await loadCommunities();
    return list.filter(function (c) { return c.slug === slug; })[0] || null;
  }
  function commHeader(c, tab) {
    var canSeeChat = c.state === 'member' || c.state === 'host';
    return '<div class="c-cover"><img src="' + esc(c.cover_url) + '" alt=""><a class="c-back" href="#/communities" aria-label="Back">' + icon('back') + '</a></div>' +
      '<div class="c-head"><div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:-30px"><img class="c-icon" src="' + esc(c.cover_url) + '" alt="">' + commBtn(c) + '</div>' +
      '<b style="font-size:20px">' + esc(c.name) + '</b>' +
      '<span style="font-size:13px;color:var(--grey)">Hosted by ' + esc(c.host_name) + ' · ' + count(c.members) + ' · ' + (c.is_private ? 'Private' : 'Public') + '</span>' +
      (c.bio ? '<p style="margin:0;font-size:14px;line-height:1.4;color:var(--ink2)">' + esc(c.bio) + '</p>' : '') + '</div>' +
      '<div class="c-tabs"><a href="#/c/' + c.slug + '" class="' + (tab === 'feed' ? 'on' : '') + '">Feed</a><a href="#/c/' + c.slug + '/chat" class="' + (tab === 'chat' ? 'on' : '') + '">Chat' + (canSeeChat ? '' : ' 🔒') + '</a></div>';
  }

  async function viewCommunity(slug) {
    loading('communities');
    var c = await getCommunity(slug);
    if (!c) { app.innerHTML = backBar('#/communities', '') + '<p class="empty">Community not found.</p>'; return; }
    var r = await sb.from('community_posts').select('*').eq('community_id', c.id).order('created_at', { ascending: false }).limit(50);
    var posts = r.data || [];
    app.innerHTML = commHeader(c, 'feed') +
      '<div style="padding:12px 12px 0;display:flex;flex-direction:column;gap:12px">' +
      (c.state === 'host' ? '<div class="c-post" style="gap:10px"><b style="font-size:14px">Post to your community</b><textarea class="input" id="cpost" rows="3" maxlength="1000" placeholder="share an update or a plan"></textarea><button class="btn black" style="padding:10px;font-size:14px" data-cpost>Post</button></div>' : '<span style="font-size:12px;color:var(--grey2)">Only the host posts here</span>') +
      (posts.length ? posts.map(function (p) {
        return '<article class="c-post"><span style="font-size:13px"><b>' + esc(p.author_name) + '</b> <span class="muted">· host · ' + ago(p.created_at) + '</span></span>' +
          (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" style="width:100%;height:170px;border-radius:10px;object-fit:cover">' : '') +
          '<span style="font-size:14px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere">' + esc(p.body) + '</span>' +
          '<span class="text-actions" style="font-size:12px;gap:20px"><button data-soon="Likes">♡ Like</button><button data-soon="Saves">Save</button></span></article>';
      }).join('') : '<p class="empty">No posts yet.</p>') + '</div>';
    bindCommBtns(); bindPosts();
    if ($('[data-cpost]')) $('[data-cpost]').onclick = async function () {
      var body = $('#cpost').value.trim(); if (!body) return;
      this.disabled = true;
      var ins = await sb.from('community_posts').insert({ community_id: c.id, author_id: me.id, author_name: profile.first_name, body: body });
      if (ins.error) { this.disabled = false; toast('Couldn\'t post. Try again.'); return; }
      toast('posted.'); route();
    };
  }

  async function viewCommunityChat(slug) {
    loading();
    var c = await getCommunity(slug);
    if (!c) { app.innerHTML = backBar('#/communities', '') + '<p class="empty">Community not found.</p>'; return; }
    var isIn = c.state === 'member' || c.state === 'host';
    if (!isIn) {
      setChrome('communities');
      app.innerHTML = commHeader(c, 'chat') + '<p class="empty">' + (c.state === 'requested' ? 'Your request is with the host. Once you\'re in, you\'ll see the chat here.' : 'Join ' + esc(c.name) + ' to see and send messages.') + '</p>';
      bindCommBtns(); return;
    }
    var r = await sb.from('community_messages').select('*').eq('community_id', c.id).order('created_at').limit(500);
    var msgs = r.data || [];
    await getProfiles(msgs.map(function (m) { return m.user_id; }).filter(Boolean));
    setChrome(null);
    app.innerHTML = commHeader(c, 'chat') +
      (c.state === 'member' ? '<div style="display:flex;justify-content:flex-end;padding:8px 12px 0"><button class="btn outline" style="font-size:12px;padding:6px 12px;color:var(--grey)" data-leave-c="' + c.id + '">Leave chat</button></div>' : '') +
      '<div class="thread" id="thread">' + (msgs.length ? '' : '<span class="sys">Say hi to the community</span>') + '</div>' +
      '<div class="composer"><form><label for="cmsg" style="position:absolute;width:1px;height:1px;overflow:hidden">Message</label><input id="cmsg" name="body" maxlength="1000" placeholder="Message ' + esc(c.name) + '" autocomplete="off"><button class="send" aria-label="Send">' + icon('send') + '</button></form></div>';
    var box = $('#thread'), seen = {};
    function add(m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      var el = document.createElement('div');
      if (m.user_id && m.user_id === me.id) { el.className = 'mine'; el.textContent = m.body; }
      else {
        var p = m.user_id ? (profileCache[m.user_id] || {}) : { first_name: m.sender_name };
        var name = (p.first_name || '') + ((m.user_id && m.user_id === c.host_id) || (!m.user_id && m.sender_name === c.host_name) ? ' · host' : '');
        el.className = 'msg';
        el.innerHTML = avatar(p, 28) + '<div style="display:flex;flex-direction:column;gap:3px"><span class="who">' + esc(name) + '</span><span class="bub">' + esc(m.body) + '</span></div>';
      }
      box.appendChild(el);
    }
    msgs.forEach(add);
    window.scrollTo(0, document.body.scrollHeight);
    bindCommBtns();
    chatChannel = sb.channel('cchat-' + c.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_messages', filter: 'community_id=eq.' + c.id }, async function (payload) {
      if (payload.new.user_id) await getProfiles([payload.new.user_id]);
      add(payload.new); window.scrollTo(0, document.body.scrollHeight);
    }).subscribe();
    $('.composer form').onsubmit = async function (e) {
      e.preventDefault();
      var body = this.body.value.trim(); if (!body) return;
      this.body.value = '';
      var ins = await sb.from('community_messages').insert({ community_id: c.id, user_id: me.id, body: body }).select().single();
      if (ins.error) { toast('Didn\'t send. Try again.'); this.body.value = body; return; }
      var s = $('.sys', box); if (s) s.remove();
      add(ins.data); window.scrollTo(0, document.body.scrollHeight);
    };
  }

  async function viewRequest(slug) {
    loading();
    var c = await getCommunity(slug);
    if (!c) { go('#/communities'); return; }
    setChrome(null);
    app.innerHTML = '<div class="sheet-bg"><div class="sheet">' +
      '<div style="display:flex;justify-content:flex-end"><a class="icon-btn" href="#/c/' + c.slug + '" aria-label="Close" style="font-size:20px;color:var(--grey)">✕</a></div>' +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center"><img src="' + esc(c.cover_url) + '" alt="" style="width:64px;height:64px;border-radius:16px;object-fit:cover">' +
      '<b style="font-size:20px">' + esc(c.name) + '</b><span style="font-size:13px;color:var(--grey)">' + count(c.members) + ' · Private · Hosted by ' + esc(c.host_name) + '</span>' +
      '<span style="font-size:13px;color:var(--grey)">The host approves every member</span></div>' +
      '<div class="sheet-box"><b style="font-size:15px">Want to join?</b><span style="font-size:13px;color:var(--grey);line-height:1.4">Send a request. If the host approves, you\'ll get a code.</span>' +
      '<label for="why" style="font-size:12px;color:var(--grey2)">Optional: say why you want to join</label><textarea class="input" id="why" rows="2" maxlength="300" placeholder="I\'m building a skincare brand and new to Miami"></textarea>' +
      (c.state === 'requested' ? '<span class="btn outline big" style="color:var(--grey2)">Request sent</span>' : '<button class="btn black big" style="padding:13px;font-size:15px" data-req>Request a code</button>') + '</div>' +
      '<div style="text-align:center;font-size:12px;color:var(--grey2)">or</div>' +
      '<div class="sheet-box"><label for="code" style="font-size:15px;font-weight:700">Already have a code?</label><div style="display:flex;gap:8px"><input class="input" id="code" placeholder="Enter code" autocapitalize="characters" style="letter-spacing:2px;height:44px"><button class="btn outline" style="border-color:var(--ink);border-radius:10px;padding:0 16px;font-size:14px" data-code>Join</button></div><p class="error" id="err"></p></div>' +
      '</div></div>';
    if ($('[data-req]')) $('[data-req]').onclick = async function () {
      this.disabled = true;
      var r = await sb.rpc('request_community', { p_comm: c.id, p_note: $('#why').value.trim() || null });
      if (r.error) { this.disabled = false; toast('Couldn\'t send. Try again.'); return; }
      toast('request sent to ' + c.host_name + '.'); go('#/communities');
    };
    $('[data-code]').onclick = async function () {
      var code = $('#code').value.trim(); if (!code) return;
      var r = await sb.rpc('join_community', { p_comm: c.id, p_code: code });
      if (r.error) { toast('Couldn\'t join. Try again.'); return; }
      if (r.data === 'wrong code') { $('#err').textContent = 'That code doesn\'t match. Check with the host.'; return; }
      toast('you\'re in.'); go('#/c/' + c.slug);
    };
  }

  function viewPitch() {
    setChrome(null);
    app.innerHTML = backBar('#/communities', 'Start a community') +
      '<div class="step-body" style="padding:16px 16px 140px;gap:14px">' +
      '<div style="display:flex;flex-direction:column;gap:4px"><b style="font-size:20px">Tell us your idea</b><span style="font-size:13px;color:var(--grey);line-height:1.4">We review every idea and reach out within a few days. Approved hosts can post to their community and to Discover.</span></div>' +
      '<div class="field"><label class="lab" for="cn">Community name</label><input class="input" id="cn" maxlength="80" placeholder="Sunday Run Club Miami"></div>' +
      '<div class="field"><label class="lab" for="ab">What\'s it about?</label><textarea class="input" id="ab" rows="3" maxlength="1000" placeholder="Who it\'s for and what you\'d do together"></textarea></div>' +
      '<div class="field"><span class="lab">How often would you host?</span><div class="choices">' + choiceList('freq', ['Weekly', 'Every 2 weeks', 'Monthly'], 'Every 2 weeks') + '</div></div>' +
      '<div class="field"><span class="lab">Public or private?</span><div class="choices">' + choiceList('priv', ['Public', 'Private (code)'], 'Public') + '</div></div>' +
      '<div class="field"><label class="lab" for="soc">Your Instagram or TikTok <i>(optional)</i></label><input class="input" id="soc" maxlength="60" placeholder="@yourhandle"></div>' +
      '</div><div class="step-foot"><div><p class="error" id="err"></p><button class="btn black big" data-send>Send my idea</button></div></div>';
    $('[data-send]').onclick = async function () {
      var name = $('#cn').value.trim(), about = $('#ab').value.trim();
      if (!name) { $('#err').textContent = 'Give your community a name.'; return; }
      if (!about) { $('#err').textContent = 'Tell us what it\'s about.'; return; }
      this.disabled = true; this.textContent = 'Sending…';
      var r = await sb.from('community_pitches').insert({ user_id: me.id, name: name, about: about, frequency: $('[name=freq]:checked').value, privacy: $('[name=priv]:checked').value, social: $('#soc').value.trim() || null });
      if (r.error) { this.disabled = false; this.textContent = 'Send my idea'; $('#err').textContent = r.error.message; return; }
      toast('idea sent. we\'ll reach out soon.'); go('#/communities');
    };
  }

  // ---------- discover ----------
  var VIBES = [['wellness', 'wellness.jpg'], ['pop-up', 'popup.jpg'], ['rooftop', 'rooftop.jpg'], ['creative', 'creative.jpg'], ['book', 'book.jpg'], ['faith', 'faith.jpg'], ['career', 'career.jpg']];
  var IMG = 'https://bb7112.github.io/momentswaitlist/images/';
  var eventCache = {};
  function evWhen(e) {
    var d = new Date(e.starts_at);
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase();
  }
  function evLine(e) { return [evWhen(e), e.neighborhood, e.price_label].filter(Boolean).join(' · '); }
  async function getEvents(ids) {
    var need = ids.filter(function (id, i) { return id && !eventCache[id] && ids.indexOf(id) === i; });
    if (need.length) {
      var r = await sb.from('events').select('*').in('id', need);
      (r.data || []).forEach(function (e) { eventCache[e.id] = e; });
    }
  }
  function eventCard(e) {
    if (!e) return '';
    return '<a class="ev-attach" href="#/e/' + e.id + '"><img src="' + esc(e.image_url) + '" alt="">' +
      '<span class="ev-attach-info"><span class="k">' + esc(evWhen(e).toUpperCase()) + '</span><b>' + esc(e.title) + '</b><span class="s">' + esc([e.neighborhood, e.price_label].filter(Boolean).join(' · ')) + '</span></span></a>';
  }
  async function mySaves() {
    var r = await sb.from('event_saves').select('event_id').eq('user_id', me.id);
    var s = {}; (r.data || []).forEach(function (x) { s[x.event_id] = 1; }); return s;
  }
  async function toggleSave(id, saved) {
    var r = saved ? await sb.from('event_saves').delete().eq('user_id', me.id).eq('event_id', id)
      : await sb.from('event_saves').insert({ user_id: me.id, event_id: id });
    if (r.error) { toast('Couldn\'t save. Try again.'); return saved; }
    toast(saved ? 'removed from saved.' : 'saved to your account.'); return !saved;
  }
  function shareEvent(e) {
    var url = location.origin + location.pathname + '#/e/' + e.id;
    if (navigator.share) navigator.share({ title: e.title, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('link copied.'); });
  }

  async function viewDiscover() {
    loading('discover');
    var r = await sb.from('events').select('*').gte('starts_at', new Date(Date.now() - 3 * 3600e3).toISOString()).order('starts_at').limit(100);
    var events = r.data || []; events.forEach(function (e) { eventCache[e.id] = e; });
    var saves = await mySaves();
    var nr = await sb.from('notes').select('event_id').not('event_id', 'is', null);
    var going = {}; (nr.data || []).forEach(function (n) { going[n.event_id] = (going[n.event_id] || 0) + 1; });
    var when = 'all', vibe = null, q = '';
    app.innerHTML = '<header class="bar plain" style="background:#fff"><div class="title">Discover</div><button class="icon-btn" data-search aria-label="Search events"><svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button></header>' +
      '<div id="sbox" hidden style="padding:12px 16px 0"><label for="esearch" style="position:absolute;width:1px;height:1px;overflow:hidden">Search events</label><input id="esearch" class="search" placeholder="Search events" autocomplete="off"></div>' +
      '<div id="dlist" style="padding-top:14px;display:flex;flex-direction:column;gap:18px"></div>';
    function inWindow(e) {
      var s = new Date(e.starts_at), now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var dayDiff = Math.floor((new Date(s.getFullYear(), s.getMonth(), s.getDate()) - today) / 864e5);
      if (when === 'tonight') return dayDiff === 0;
      if (when === 'week') return dayDiff >= 0 && dayDiff < 7;
      if (when === 'weekend') {
        var dow = now.getDay(), toFri = (5 - dow + 7) % 7; if (dow === 6) toFri = -1; if (dow === 0) toFri = -2;
        return dayDiff >= Math.max(0, toFri) && dayDiff <= toFri + 2;
      }
      return true;
    }
    function draw() {
      var list = events.filter(function (e) { return inWindow(e) && (!vibe || e.vibe === vibe) && (!q || (e.title + ' ' + e.neighborhood + ' ' + e.vibe + ' ' + (e.description || '')).toLowerCase().indexOf(q) > -1); });
      var feat = list.filter(function (e) { return e.featured; });
      $('#dlist').innerHTML =
        '<div class="pill-row">' + [['all', 'All'], ['tonight', 'Tonight'], ['weekend', 'This weekend'], ['week', 'This week']].map(function (p) { return '<button class="fpill' + (when === p[0] ? ' on' : '') + '" data-when="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
        '<section style="display:flex;flex-direction:column;gap:10px"><b style="font-size:16px;padding:0 16px">Events by vibe</b><div class="vibe-row">' +
        VIBES.map(function (v) { return '<button class="vibe' + (vibe === v[0] ? ' on' : '') + '" data-vibe="' + v[0] + '"><img src="' + IMG + v[1] + '" alt="">' + v[0] + '</button>'; }).join('') + '</div></section>' +
        (feat.length ? '<section style="display:flex;flex-direction:column;gap:10px"><b style="font-size:16px;padding:0 16px">Featured this week</b><div class="feat-row">' +
          feat.map(function (e) { return '<a class="feat" href="#/e/' + e.id + '"><img src="' + esc(e.image_url) + '" alt=""><b>' + esc(e.title) + '</b><span>' + esc(evLine(e)) + '</span></a>'; }).join('') + '</div></section>' : '') +
        '<section class="csec"><b>Coming up</b>' +
        (list.length ? list.map(function (e) {
          return '<div class="ev-row"><a class="ev-link" href="#/e/' + e.id + '"><img src="' + esc(e.image_url) + '" alt="">' +
            '<span class="t"><b>' + esc(e.title) + '</b><span>' + esc(evLine(e)) + '</span><span>' + (going[e.id] ? going[e.id] + (going[e.id] === 1 ? ' note' : ' notes') + ' from people going' : 'Posted by ' + esc(e.posted_by)) + '</span></span></a>' +
            '<button class="save-btn' + (saves[e.id] ? ' on' : '') + '" data-save="' + e.id + '">' + (saves[e.id] ? 'Saved' : 'Save') + '</button></div>';
        }).join('') : '<p class="empty" style="padding:24px 8px">Nothing here yet. Try another day or vibe.</p>') + '</section>';
      $$('[data-when]').forEach(function (b) { b.onclick = function () { when = b.dataset.when; draw(); }; });
      $$('[data-vibe]').forEach(function (b) { b.onclick = function () { vibe = vibe === b.dataset.vibe ? null : b.dataset.vibe; draw(); }; });
      $$('[data-save]').forEach(function (b) { b.onclick = async function () { var id = b.dataset.save; saves[id] = (await toggleSave(id, !!saves[id])) ? 1 : 0; if (!saves[id]) delete saves[id]; draw(); }; });
    }
    draw();
    $('[data-search]').onclick = function () { var s = $('#sbox'); s.hidden = !s.hidden; if (!s.hidden) $('#esearch').focus(); };
    $('#esearch').oninput = function () { q = this.value.trim().toLowerCase(); draw(); };
  }

  async function viewEvent(id) {
    loading();
    var r = await sb.from('events').select('*').eq('id', id).maybeSingle();
    var e = r.data;
    if (!e) { app.innerHTML = backBar('#/discover', '') + '<p class="empty">This event isn\'t available anymore.</p>'; return; }
    eventCache[e.id] = e;
    var saves = await mySaves(), saved = !!saves[e.id];
    var nr = await sb.from('notes').select('*, note_members(user_id)').eq('event_id', id).order('created_at', { ascending: false });
    var notes = nr.data || [];
    var ids = []; notes.forEach(function (n) { ids.push(n.author_id); (n.note_members || []).forEach(function (m) { ids.push(m.user_id); }); });
    await getProfiles(ids);
    var d = new Date(e.starts_at), end = e.ends_at ? new Date(e.ends_at) : null;
    var t = function (x) { return x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase(); };
    setChrome(null);
    app.innerHTML = '<div class="ev-hero"><img src="' + esc(e.image_url) + '" alt=""><a class="c-back" href="javascript:history.back()" aria-label="Back">' + icon('back') + '</a></div>' +
      '<div style="padding:16px 16px 120px;display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:12px;color:var(--grey2);font-weight:600;letter-spacing:.3px">' + esc((e.vibe + ' · posted by ' + e.posted_by).toUpperCase()) + '</span>' +
      '<b style="font-size:24px">' + esc(e.title) + '</b>' +
      '<span style="font-size:14px;color:var(--grey)">' + esc(d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t(d) + (end ? ' to ' + t(end) : '')) + '</span>' +
      '<span style="font-size:14px;color:var(--grey)">' + esc([e.neighborhood, e.address].filter(Boolean).join(' · ')) + '</span></div>' +
      (e.description ? '<p style="margin:0;font-size:14px;line-height:1.45;color:var(--ink2)">' + esc(e.description) + '</p>' : '') +
      '<div class="ev-actions"><a href="#/new/' + e.id + '"><svg class="ico" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>Reshare to Home</a>' +
      '<button data-save-one>' + icon('save') + '<span id="savelbl">' + (saved ? 'Saved' : 'Save') + '</span></button>' +
      '<button data-share-one>' + icon('send') + 'Share</button></div>' +
      '<section style="display:flex;flex-direction:column;gap:8px"><b style="font-size:15px">People looking for company (' + notes.length + ')</b>' +
      (notes.length ? notes.map(function (n) {
        var a = profileCache[n.author_id] || {}, st = noteState(n);
        return '<a class="company" href="#/note/' + n.id + '"><span style="font-size:13px"><b>' + esc(a.first_name || '') + '</b> <span class="muted">· ' + ago(n.created_at) + '</span></span><span style="font-size:14px">' + esc(n.body) + '</span><span style="font-size:12px;color:var(--grey)">' + (st.joined ? 'You\'re going' : st.left ? st.left + ' of ' + n.spots + ' spots left · Join' : 'Full') + '</span></a>';
      }).join('') : '<p class="muted" style="margin:0;font-size:14px">No one yet. Reshare it to Home and find someone to go with.</p>') + '</section></div>' +
      '<div class="ticket-bar"><div style="display:flex;flex-direction:column;flex:1"><b style="font-size:16px">' + esc(e.price_label) + '</b><span style="font-size:12px;color:var(--grey2)">' + (e.ticket_source ? 'Tickets on ' + esc(e.ticket_source) : 'Tickets with the host') + '</span></div>' +
      (e.ticket_url ? '<a class="btn black" style="font-size:15px;padding:13px 22px" href="' + esc(e.ticket_url) + '" target="_blank" rel="noopener" data-ticket>Get tickets ↗</a>' : '') + '</div>';
    $('[data-save-one]').onclick = async function () { saved = await toggleSave(e.id, saved); $('#savelbl').textContent = saved ? 'Saved' : 'Save'; };
    $('[data-share-one]').onclick = function () { shareEvent(e); };
    var tk = $('[data-ticket]');
    if (tk) tk.onclick = function () { if (me) sb.from('ticket_clicks').insert({ user_id: me.id, event_id: e.id }).then(function () {}); };
  }

  // chat route with optional "/joined" flag
  var baseRoute = route;
  route = async function () {
    var h = location.hash.replace(/^#/, '');
    var m = h.match(/^\/chat\/([^/]+)\/joined$/);
    if (m && me && profile && profile.rules_accepted_at) { stopChat(); return viewChat(m[1], true); }
    return baseRoute();
  };

  // ---------- start ----------
  var booted = false;
  sb.auth.onAuthStateChange(function (event) {
    if (booted && event === 'SIGNED_IN' && !me) { loadMe().then(route); }
    if (event === 'SIGNED_OUT') { me = null; profile = null; }
  });
  window.addEventListener('hashchange', function () { route(); });
  loading();
  loadMe().then(function () {
    if (/access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
    booted = true;
    route();
  });
})();
