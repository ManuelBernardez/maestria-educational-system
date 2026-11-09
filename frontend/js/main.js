(() => {
  'use strict';
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  const closeMenu = () => { if (!menuButton || !nav) return; menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', 'Abrir menú'); nav.classList.remove('is-open'); };
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => { const open = menuButton.getAttribute('aria-expanded') === 'true'; menuButton.setAttribute('aria-expanded', String(!open)); menuButton.setAttribute('aria-label', open ? 'Abrir menú' : 'Cerrar menú'); nav.classList.toggle('is-open', !open); });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    document.addEventListener('click', event => { if (nav.classList.contains('is-open') && !nav.contains(event.target) && !menuButton.contains(event.target)) closeMenu(); });
  }
  // Desplegables exclusivos: <details name="…"> ya lo resuelve el navegador; esto sólo
  // cubre navegadores sin soporte del atributo, plegando los hermanos del mismo grupo.
  if (!('name' in HTMLDetailsElement.prototype)) {
    document.addEventListener('toggle', event => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open || !details.getAttribute('name')) return;
      document.querySelectorAll(`details[name="${CSS.escape(details.getAttribute('name'))}"][open]`).forEach(other => { if (other !== details) other.open = false; });
    }, true);
  }
  const progress = document.querySelector('.scroll-progress'), header = document.querySelector('.site-header'); let ticking = false;
  const updateScrollUI = () => { const max = document.documentElement.scrollHeight - window.innerHeight; if (progress) progress.value = max > 0 ? (window.scrollY / max) * 100 : 0; if (header) header.classList.toggle('is-scrolled', window.scrollY > 12); ticking = false; };
  window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(updateScrollUI); ticking = true; } }, { passive: true }); updateScrollUI();
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) { const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: .12, rootMargin: '0px 0px -45px 0px' }); revealItems.forEach(item => observer.observe(item)); }
  else revealItems.forEach(item => item.classList.add('is-visible'));
  const form = document.querySelector('[data-contact-form]');
  if (form) {
    const status = document.getElementById('contact-status'), submit = form.querySelector('[type="submit"]');
    const setStatus = (message, kind = '') => { if (!status) return; status.textContent = message; status.classList.remove('is-error', 'is-success'); if (kind) status.classList.add(kind); };
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = { name: String(values.name || '').trim(), email: String(values.email || '').trim(), subject: String(values.subject || values.topic || '').trim(), category: String(values.category || 'general'), message: String(values.message || '').trim(), website: String(values.website || '') };
      submit.disabled = true; setStatus('Enviando tu consulta…');
      try { await window.MAESTRIA_API.post('contact/', payload, { allowAnonymous: true }); form.reset(); setStatus('Tu consulta fue recibida. Gracias por escribirnos.', 'is-success'); }
      catch (error) { setStatus(error.message || 'No pudimos enviar el mensaje. Revisá tu conexión e intentá nuevamente.', 'is-error'); }
      finally { submit.disabled = false; }
    });
  }
})();
