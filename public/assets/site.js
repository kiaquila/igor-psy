(function () {
  var root = document.documentElement;
  var top = document.querySelector('.top');
  var menu = top.querySelector('.menu');
  var toggle = top.querySelector('.toggle');

  // On phones the sections open as a full-screen list from the menu button.
  function setOpen(open) {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
    document.body.classList.toggle('lock', open);
  }
  function isOpen() { return menu.classList.contains('open'); }

  toggle.addEventListener('click', function () { setOpen(!isOpen()); });
  menu.addEventListener('click', function (event) { if (event.target.closest('a')) setOpen(false); });
  addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !isOpen()) return;
    setOpen(false);
    toggle.focus();
  });
  // Close the list when keyboard focus moves on to the page behind it.
  top.addEventListener('focusout', function (event) {
    if (isOpen() && event.relatedTarget && !top.contains(event.relatedTarget)) setOpen(false);
  });
  matchMedia('(min-width:1000px)').addEventListener('change', function () { setOpen(false); });

  if (menu.id !== 'menu') return;
  var links = [].slice.call(menu.querySelectorAll('a'));
  var secs = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  var current = -1;

  // Pass the header height to CSS so each section can fill the remaining viewport.
  function measure() {
    root.style.setProperty('--hh', top.offsetHeight + 'px');
  }

  // Highlight the current section in the header.
  function spy() {
    var line = top.getBoundingClientRect().bottom + innerHeight * 0.3;
    var idx = -1;
    secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= line) idx = i; });
    if (innerHeight + scrollY >= root.scrollHeight - 4) idx = secs.length - 1;
    if (idx === current) return;
    current = idx;
    links.forEach(function (a, i) {
      a.classList.toggle('on', i === idx);
      if (i === idx) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }

  measure();
  addEventListener('resize', function () { measure(); spy(); });
  addEventListener('scroll', spy, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  spy();
  addEventListener('load', function () {
    spy();
    setTimeout(function () { root.classList.add('ready'); }, 100);
  });
})();
