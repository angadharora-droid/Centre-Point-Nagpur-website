/* Progressive enhancement for the captured WPForms event-enquiry form (id 4592).
   Keeps the original markup and styling; submits the fields as JSON to the API. */
(() => {
  'use strict';
  const base = (window.CENTREPOINT_CONFIG || {}).apiBaseUrl || '';

  const value = (form, name) => {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? String(el.value || '').trim() : '';
  };

  const clearErrors = form => {
    form.querySelectorAll('.cp-field-error').forEach(n => n.remove());
    form.querySelectorAll('.cp-has-error').forEach(n => n.classList.remove('cp-has-error'));
  };

  const showError = (form, name, message) => {
    const el = form.querySelector(`[name="${name}"]`);
    const target = el ? (el.closest('.wpforms-field') || el.parentNode) : form;
    const note = document.createElement('label');
    note.className = 'wpforms-error cp-field-error';
    note.textContent = message;
    if (el) el.classList.add('cp-has-error');
    target.appendChild(note);
  };

  const confirm = container => {
    const box = document.createElement('div');
    box.className = 'wpforms-confirmation-container-full';
    box.setAttribute('role', 'alert');
    box.innerHTML = '<p>Thank you for your enquiry. Our events team will be in touch with you shortly.</p>';
    container.innerHTML = '';
    container.appendChild(box);
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const fieldMap = {
    name: 'wpforms[fields][1][first]', email: 'wpforms[fields][2]', phone: 'wpforms[fields][12]',
    eventType: 'wpforms[fields][5]', eventDate: 'wpforms[fields][6][date]', guests: 'wpforms[fields][7]',
    meals: 'wpforms[fields][13]',
  };

  const submit = async (form, button) => {
    clearErrors(form);
    const payload = {
      name: `${value(form, 'wpforms[fields][1][first]')} ${value(form, 'wpforms[fields][1][last]')}`.trim(),
      email: value(form, 'wpforms[fields][2]'),
      phone: value(form, 'wpforms[fields][12]'),
      eventType: value(form, 'wpforms[fields][5]'),
      eventDate: value(form, 'wpforms[fields][6][date]'),
      guests: value(form, 'wpforms[fields][7]'),
      meals: value(form, 'wpforms[fields][13]'),
      message: value(form, 'wpforms[fields][3]'),
      company: value(form, 'wpforms[fields][4]'),
      page: window.location.pathname,
    };

    const busyText = button ? (button.getAttribute('data-alt-text') || 'Sending...') : null;
    const restore = button ? (button.textContent || button.value) : null;
    if (button) { button.disabled = true; if ('value' in button) button.value = busyText; button.textContent = busyText; }

    try {
      const response = await fetch(`${base}/api/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201 || body.ok) {
        confirm(form.closest('.wpforms-container') || form.parentNode);
        return;
      }
      const errors = body.errors || {};
      let shown = false;
      for (const key of Object.keys(errors)) {
        if (fieldMap[key]) { showError(form, fieldMap[key], errors[key]); shown = true; }
      }
      if (!shown) showError(form, 'wpforms[fields][2]', body.error || 'Something went wrong. Please try again or call the hotel.');
    } catch {
      showError(form, 'wpforms[fields][2]', 'Network error. Please try again or call the hotel.');
    } finally {
      if (button) { button.disabled = false; if ('value' in button) button.value = restore; button.textContent = restore; }
    }
  };

  const enhance = form => {
    if (form.dataset.cpEnhanced) return;
    form.dataset.cpEnhanced = '1';
    form.setAttribute('novalidate', 'novalidate');
    const button = form.querySelector('button[type="submit"], input[type="submit"]');
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void submit(form, button);
    }, true);
  };

  const init = () => {
    const forms = document.querySelectorAll('form[id^="wpforms-form-"]');
    if (!forms.length) return;
    const style = document.createElement('style');
    style.textContent = '.cp-has-error{border-color:#b3261e !important}.cp-field-error{display:block;color:#b3261e;font-size:.85em;margin-top:.35em}';
    document.head.appendChild(style);
    forms.forEach(enhance);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
