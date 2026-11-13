(function () {
  var top = document.querySelector('.top');
  var menu = top.querySelector('.menu');

  menu.addEventListener('focusin', function (event) {
    if (menu.scrollWidth <= menu.clientWidth) return;

    var link = event.target.getBoundingClientRect();
    var viewport = menu.getBoundingClientRect();
    var left = link.left - viewport.left - 8;
    var right = link.right - viewport.right + 8;
    if (left < 0) menu.scrollLeft += left;
    else if (right > 0) menu.scrollLeft += right;
  });

  if (menu.id !== 'menu') return;
  var links = [].slice.call(menu.querySelectorAll('a'));
  var secs = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  var current = -1;

  // Pass the header height to CSS so each section can fill the remaining viewport.
  function measure() {
    document.documentElement.style.setProperty('--hh', top.offsetHeight + 'px');
  }

  // Highlight the current section in the header.
  function spy() {
    var line = top.getBoundingClientRect().bottom + innerHeight * 0.3;
    var idx = -1;
    secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= line) idx = i; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) idx = secs.length - 1;
    if (idx === current) return;
    current = idx;
    links.forEach(function (a, i) {
      a.classList.toggle('on', i === idx);
      if (i === idx) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    var a = links[idx];
    if (menu.scrollWidth > menu.clientWidth && !menu.contains(document.activeElement)) {
      menu.scrollTo({ left: a ? a.offsetLeft - menu.offsetLeft - 16 : 0, behavior: 'smooth' });
    }
  }

  measure();
  addEventListener('resize', function () { measure(); spy(); });
  addEventListener('scroll', spy, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  spy();
  addEventListener('load', function () {
    spy();
    setTimeout(function () { document.documentElement.classList.add('ready'); }, 100);
  });
})();
