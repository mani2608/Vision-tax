/**
 * Vision-Tax Redesign - Main JavaScript
 * Interactive Features: Tax Estimator, State Refund Search, FAQ Accordion, Mobile Drawer, Modals
 */

document.addEventListener('DOMContentLoaded', () => {
  initStickyHeader();
  initNavDropdown();
  initMobileDrawer();
  initHeroSlider();
  initServicesTabs();
  initFaqAccordion();
  initTaxCalculator();
  initStateRefundSearch();
  initConsultationModal();
  initPaymentInfo();
  initPaymentModal();
  initContactForm();
});

/* ==========================================================================
   1. Sticky Header with Scroll Effect
   ========================================================================== */
function initStickyHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

/* ==========================================================================
   1b. Navigation Dropdown Toggle
   ========================================================================== */
function initNavDropdown() {
  const dropdowns = document.querySelectorAll('.nav-dropdown');
  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    if (!toggle) return;

    dropdown.addEventListener('mouseenter', () => {
      dropdown.classList.add('open');
    });

    dropdown.addEventListener('mouseleave', () => {
      dropdown.classList.remove('open');
    });

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      dropdown.classList.toggle('open');
    });
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      dropdowns.forEach(d => d.classList.remove('open'));
    }
  });
}

/* ==========================================================================
   2. Mobile Drawer Navigation
   ========================================================================== */
function initMobileDrawer() {
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const drawer = document.querySelector('.mobile-drawer');
  const overlay = document.querySelector('.mobile-drawer-overlay');
  const closeBtn = document.querySelector('.drawer-close');

  if (!drawer || !overlay) return;

  function openDrawer() {
    drawer.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (toggleBtn) toggleBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', closeDrawer);

  // Close drawer on link click
  const drawerLinks = drawer.querySelectorAll('a');
  drawerLinks.forEach(link => {
    link.addEventListener('click', closeDrawer);
  });
}

/* ==========================================================================
   2b. Hero Banner Slider / Carousel
   ========================================================================== */
function initHeroSlider() {
  const slider = document.getElementById('hero-slider');
  if (!slider) return;

  const slides = slider.querySelectorAll('.hero-slide');
  const dots = slider.querySelectorAll('.hero-slider-dot');
  const prevBtn = document.getElementById('hero-prev-btn');
  const nextBtn = document.getElementById('hero-next-btn');
  const counterCurrent = slider.querySelector('.hero-slider-counter .current-slide');
  const counterTotal = slider.querySelector('.hero-slider-counter .total-slides');

  if (slides.length <= 1) return;

  let currentIndex = 0;
  const totalSlides = slides.length;
  let autoplayTimer = null;
  const AUTOPLAY_DELAY = 6000;

  if (counterTotal) {
    counterTotal.textContent = String(totalSlides).padStart(2, '0');
  }

  function goToSlide(index) {
    if (index < 0) {
      index = totalSlides - 1;
    } else if (index >= totalSlides) {
      index = 0;
    }

    currentIndex = index;

    slides.forEach((slide, i) => {
      const isActive = i === currentIndex;
      slide.classList.toggle('active', isActive);
      slide.setAttribute('aria-hidden', !isActive);
    });

    dots.forEach((dot, i) => {
      const isActive = i === currentIndex;
      dot.classList.toggle('active', isActive);
      dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (counterCurrent) {
      counterCurrent.textContent = String(currentIndex + 1).padStart(2, '0');
    }
  }

  function nextSlide() {
    goToSlide(currentIndex + 1);
  }

  function prevSlide() {
    goToSlide(currentIndex - 1);
  }

  function startAutoplay() {
    stopAutoplay();
    autoplayTimer = setInterval(nextSlide, AUTOPLAY_DELAY);
  }

  function stopAutoplay() {
    if (autoplayTimer) {
      clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
  }

  // Event Listeners for Navigation Buttons
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      nextSlide();
      startAutoplay();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      prevSlide();
      startAutoplay();
    });
  }

  // Event Listeners for Dots
  dots.forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      const targetIndex = parseInt(dot.getAttribute('data-index'), 10);
      if (!isNaN(targetIndex)) {
        goToSlide(targetIndex);
        startAutoplay();
      }
    });
  });

  // Pause on hover
  slider.addEventListener('mouseenter', stopAutoplay);
  slider.addEventListener('mouseleave', startAutoplay);

  // Keyboard navigation when slider is in viewport
  document.addEventListener('keydown', (e) => {
    const rect = slider.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;

    if (e.key === 'ArrowLeft') {
      prevSlide();
      startAutoplay();
    } else if (e.key === 'ArrowRight') {
      nextSlide();
      startAutoplay();
    }
  });

  // Touch & Swipe Support for Mobile/Tablet
  let touchStartX = 0;
  let touchEndX = 0;

  slider.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    stopAutoplay();
  }, { passive: true });

  slider.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 45) {
      if (diff > 0) {
        nextSlide();
      } else {
        prevSlide();
      }
    }
    startAutoplay();
  }, { passive: true });

  // Initialize
  goToSlide(0);
  startAutoplay();
}

/* ==========================================================================
   2c. Services Page Tab Filter Active State & Scroll Spy
   ========================================================================== */
function initServicesTabs() {
  const tabs = document.querySelectorAll('.service-filter-pill');
  if (!tabs.length) return;

  const indSec = document.getElementById('individual-services');
  const busSec = document.getElementById('business-services');
  const tabInd = document.getElementById('tab-individual');
  const tabBus = document.getElementById('tab-business');

  tabs.forEach(tab => {
    tab.addEventListener('click', function(e) {
      tabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
    });
  });

  if (indSec && busSec && tabInd && tabBus) {
    window.addEventListener('scroll', () => {
      const scrollPos = window.scrollY + 200;
      const busTop = busSec.offsetTop;
      if (scrollPos >= busTop) {
        tabInd.classList.remove('active');
        tabBus.classList.add('active');
      } else {
        tabInd.classList.add('active');
        tabBus.classList.remove('active');
      }
    }, { passive: true });
  }
}

/* ==========================================================================
   3. FAQ Accordion
   ========================================================================== */
function initFaqAccordion() {
  // Standard FAQ items (Home / Pricing / FAQ sections)
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (!questionBtn) return;

    questionBtn.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      faqItems.forEach(otherItem => otherItem.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // Service pages accordion (.faq-accordion-header)
  const accordionHeaders = document.querySelectorAll('.faq-accordion-header');
  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      const isOpen = body && body.classList.contains('open');

      document.querySelectorAll('.faq-accordion-body').forEach(b => b.classList.remove('open'));
      document.querySelectorAll('.faq-accordion-header').forEach(h => h.classList.remove('active'));

      if (!isOpen && body) {
        body.classList.add('open');
        header.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   4. Interactive US Tax Refund / Liability Calculator
   ========================================================================== */
function initTaxCalculator() {
  const calcForm = document.getElementById('tax-calc-form');
  if (!calcForm) return;

  const filingStatusEl = document.getElementById('calc-status');
  const visaTypeEl = document.getElementById('calc-visa');
  const incomeEl = document.getElementById('calc-income');
  const withheldEl = document.getElementById('calc-withheld');
  const deductionsEl = document.getElementById('calc-deductions');

  const outTaxableIncome = document.getElementById('out-taxable-income');
  const outTotalTax = document.getElementById('out-total-tax');
  const outWithheld = document.getElementById('out-withheld');
  const outRefundAmount = document.getElementById('out-refund-amount');
  const outRefundLabel = document.getElementById('out-refund-label');
  const outRefundTag = document.getElementById('out-refund-tag');

  function calculateTax() {
    const status = filingStatusEl ? filingStatusEl.value : 'single';
    const visa = visaTypeEl ? visaTypeEl.value : 'resident';
    const income = Math.max(0, parseFloat(incomeEl ? incomeEl.value : 0) || 0);
    const withheld = Math.max(0, parseFloat(withheldEl ? withheldEl.value : 0) || 0);
    const extraDeductions = Math.max(0, parseFloat(deductionsEl ? deductionsEl.value : 0) || 0);

    // Standard deductions 2026/2027
    let standardDeduction = 16100;
    if (status === 'married_joint') standardDeduction = 32200;
    else if (status === 'married_separate') standardDeduction = 16100;
    else if (status === 'hoh') standardDeduction = 24150;

    // Non-resident aliens (1040-NR / F-1 / J-1 without treaty) generally cannot claim standard deduction
    // Exception: Indian students under Article 21(2) of US-India Tax Treaty can claim standard deduction!
    if (visa === 'f1_opt') {
      // Indian students on F-1/OPT eligible for treaty benefit
      standardDeduction = 16100;
    } else if (visa === 'non_resident') {
      standardDeduction = 0; // Standard rule for generic non-residents
    }

    const totalDeductions = standardDeduction + extraDeductions;
    const taxableIncome = Math.max(0, income - totalDeductions);

    // Compute Federal Tax (2024 brackets for Single / Non-resident baseline)
    let tax = 0;
    if (status === 'married_joint') {
      if (taxableIncome <= 23200) {
        tax = taxableIncome * 0.10;
      } else if (taxableIncome <= 94300) {
        tax = 2320 + (taxableIncome - 23200) * 0.12;
      } else if (taxableIncome <= 201050) {
        tax = 10852 + (taxableIncome - 94300) * 0.22;
      } else {
        tax = 34337 + (taxableIncome - 201050) * 0.24;
      }
    } else {
      // Single / MFS / 1040-NR
      if (taxableIncome <= 11600) {
        tax = taxableIncome * 0.10;
      } else if (taxableIncome <= 47150) {
        tax = 1160 + (taxableIncome - 11600) * 0.12;
      } else if (taxableIncome <= 100525) {
        tax = 5426 + (taxableIncome - 47150) * 0.22;
      } else {
        tax = 17168.5 + (taxableIncome - 100525) * 0.24;
      }
    }

    tax = Math.round(tax);
    const refundDiff = withheld - tax;

    // Update UI elements
    if (outTaxableIncome) outTaxableIncome.textContent = '$' + taxableIncome.toLocaleString();
    if (outTotalTax) outTotalTax.textContent = '$' + tax.toLocaleString();
    if (outWithheld) outWithheld.textContent = '$' + Math.round(withheld).toLocaleString();

    if (refundDiff >= 0) {
      if (outRefundLabel) outRefundLabel.textContent = 'ESTIMATED TAX REFUND';
      if (outRefundAmount) {
        outRefundAmount.textContent = '+$' + Math.round(refundDiff).toLocaleString();
        outRefundAmount.style.color = '#34d399';
      }
      if (outRefundTag) {
        outRefundTag.textContent = '🎉 You are due an IRS refund!';
        outRefundTag.style.color = '#93c5fd';
      }
    } else {
      const amountDue = Math.abs(refundDiff);
      if (outRefundLabel) outRefundLabel.textContent = 'ESTIMATED TAX BALANCE DUE';
      if (outRefundAmount) {
        outRefundAmount.textContent = '-$' + Math.round(amountDue).toLocaleString();
        outRefundAmount.style.color = '#f87171';
      }
      if (outRefundTag) {
        outRefundTag.textContent = '💡 Our CPAs can uncover deductions to reduce this!';
        outRefundTag.style.color = '#fde047';
      }
    }
  }

  // Attach live listeners
  [filingStatusEl, visaTypeEl, incomeEl, withheldEl, deductionsEl].forEach(el => {
    if (el) {
      el.addEventListener('input', calculateTax);
      el.addEventListener('change', calculateTax);
    }
  });

  // Calculate initial default
  calculateTax();
}

/* ==========================================================================
   5. Search & Filter 50 US State Refund Portals
   ========================================================================== */
function initStateRefundSearch() {
  const searchInput = document.getElementById('state-search-input');
  const statesGrid = document.getElementById('states-grid');
  if (!searchInput || !statesGrid) return;

  const stateCards = statesGrid.querySelectorAll('.state-item-card');
  const noResultMsg = document.getElementById('state-no-results');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    let visibleCount = 0;

    stateCards.forEach(card => {
      const stateName = card.textContent.toLowerCase();
      if (stateName.includes(query)) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (noResultMsg) {
      noResultMsg.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  });
}

/* ==========================================================================
   6. Consultation Modal & Lead Capture
   ========================================================================== */
function initConsultationModal() {
  const modalOverlay = document.getElementById('consultation-modal');
  const openButtons = document.querySelectorAll('[data-open-modal="consultation"]');
  const closeButton = modalOverlay ? modalOverlay.querySelector('.modal-close-btn') : null;

  if (!modalOverlay) return;

  function openModal(e) {
    if (e) e.preventDefault();
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  openButtons.forEach(btn => btn.addEventListener('click', openModal));
  if (closeButton) closeButton.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Modal Form Submit
  const modalForm = document.getElementById('consultation-form');
  if (modalForm) {
    modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      closeModal();
      showToast('Thank you! A Vision Tax CPA will contact you within 2 hours.');
      modalForm.reset();
    });
  }
}

/* ==========================================================================
   6b. Secure Payment & Checkout Modal
   ========================================================================== */
function initPaymentModal() {
  const modalOverlay = document.getElementById('payment-modal');
  const openButtons = document.querySelectorAll('[data-open-modal="payment"]');
  const closeButton = modalOverlay ? modalOverlay.querySelector('.modal-close-btn') : null;

  if (!modalOverlay) return;

  function openModal(e) {
    if (e) e.preventDefault();
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  openButtons.forEach(btn => btn.addEventListener('click', openModal));
  if (closeButton) closeButton.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  initRazorpayCheckout(modalOverlay, closeModal);
}

/* ==========================================================================
   6c. Razorpay Test-Mode checkout (INR). The amount is re-validated by the server and success is only ever
   reported after the server has verified the payment signature with Razorpay; the browser never decides it.
   ========================================================================== */
function initRazorpayCheckout(modalOverlay, closeModal) {
  const form = document.getElementById('secure-payment-form');
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const submitBtn = $('pay-submit-btn');
  const note = $('pay-method-note');
  const errBox = $('pay-form-error');
  const result = $('pay-result');
  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  const MANUAL = { zelle: 'Zelle', paypal: 'PayPal' };
  let lastOrderId = null;

  const post = async (path, body) => {
    const r = await fetch(`/api/payments/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the secure checkout. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }

  const setError = (msg) => { errBox.textContent = msg || ''; errBox.hidden = !msg; };
  const showForm = () => { result.hidden = true; form.hidden = false; setError(''); };

  function showResult({ status, message, reason, reference, amount, currency, orderId }) {
    const ui = {
      successful: ['fa-circle-check', '#10b981', 'Payment successful'],
      pending: ['fa-hourglass-half', '#d97706', 'Payment pending'],
      failed: ['fa-circle-xmark', '#dc2626', 'Payment failed'],
      cancelled: ['fa-ban', '#64748b', 'Payment cancelled'],
      refunded: ['fa-rotate-left', '#64748b', 'Payment refunded'],
      created: ['fa-circle-info', '#64748b', 'Payment not completed'],
    }[status] || ['fa-circle-info', '#64748b', 'Payment status'];
    lastOrderId = orderId || lastOrderId;
    $('pay-result-icon').innerHTML = `<i class="fa-solid ${ui[0]}" style="color:${ui[1]}"></i>`;
    $('pay-result-title').textContent = ui[2];
    $('pay-result-msg').textContent = reason && status === 'failed' ? `${message} (${reason})` : message;
    const dl = $('pay-result-details');
    dl.textContent = '';
    const rows = [];
    if (amount) rows.push(['Amount', inr.format(Number(amount))]);
    if (reference) rows.push(['Transaction ID', reference]);
    if (orderId) rows.push(['Order ID', orderId]);
    rows.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:3px 0;';
      const dt = document.createElement('dt'); dt.textContent = k; dt.style.color = '#64748b';
      const dd = document.createElement('dd'); dd.textContent = v; dd.style.cssText = 'margin:0;font-weight:600;word-break:break-all;text-align:right;';
      row.append(dt, dd); dl.appendChild(row);
    });
    dl.style.display = rows.length ? 'block' : 'none';
    $('pay-result-check').hidden = !(status === 'pending' || status === 'created');
    $('pay-result-retry').hidden = !(status === 'failed' || status === 'cancelled' || status === 'created');
    form.hidden = true;
    result.hidden = false;
  }

  function applyMethod() {
    const m = (form.querySelector('input[name="pay_gateway"]:checked') || {}).value;
    if (MANUAL[m]) {
      note.textContent = `${MANUAL[m]} is a manual payment option and is not available for online checkout. Please use the payment details shown on this page, or choose Card for secure online payment.`;
      note.hidden = false;
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.55';
      submitBtn.style.cursor = 'not-allowed';
    } else {
      note.hidden = true;
      submitBtn.disabled = false;
      submitBtn.style.opacity = '';
      submitBtn.style.cursor = '';
    }
  }
  form.querySelectorAll('input[name="pay_gateway"]').forEach((r) => r.addEventListener('change', applyMethod));
  applyMethod();

  // Any country is accepted: searchable country selector + libphonenumber validation (identical rules on the server).
  // The configured default country only pre-selects the dropdown; it never restricts input.
  const phoneField = window.VTPhoneInput ? VTPhoneInput.mount($('pay-modal-phone'), { defaultCountry: 'US' }) : null;
  fetch('/api/public/config', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => { if (c && c.defaultCountry && phoneField) phoneField.setDefaultCountry(c.defaultCountry); })
    .catch(() => {});

  // Plan prices come from the server (display only; the server recomputes the amount on every order).
  const planSel = $('pay-modal-plan');
  const amountEl = $('pay-modal-amount');
  const refWrap = $('pay-ref-wrap');
  const refEl = $('pay-modal-ref');
  let plans = {};
  function syncPlan() {
    const p = plans[planSel.value];
    const custom = Boolean(p) && p.amount === null;
    refWrap.hidden = !custom;
    amountEl.value = p && p.amount ? p.amount : '';
    amountEl.placeholder = custom ? 'Enter your reference' : (p ? 'Price unavailable' : 'Select a plan');
    if (!custom) refEl.value = '';
  }
  async function lookupReference() {
    const code = refEl.value.trim().toUpperCase();
    refEl.value = code;
    amountEl.value = '';
    if (!code) return;
    try {
      const r = await fetch(`/api/payments/reference/${encodeURIComponent(code)}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Invalid reference.');
      amountEl.value = d.amount;
      setError('');
    } catch (err) { setError(err.message); }
  }
  planSel.addEventListener('change', () => { setError(''); syncPlan(); });
  refEl.addEventListener('change', lookupReference);
  form.addEventListener('reset', () => setTimeout(syncPlan));
  fetch('/api/payments/plans', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && d.plans) { plans = d.plans; syncPlan(); } })
    .catch(() => {});

  // Reset to the form when the popup is closed (unless a payment is still pending verification).
  let lastStatus = null;
  new MutationObserver(() => {
    if (!modalOverlay.classList.contains('active') && !result.hidden && lastStatus !== 'pending') {
      if (lastStatus === 'successful') form.reset();
      showForm();
    }
  }).observe(modalOverlay, { attributes: true, attributeFilter: ['class'] });
  const show = (r) => { lastStatus = r.status; showResult(r); };

  $('pay-result-close').addEventListener('click', () => { closeModal(); if (lastStatus !== 'pending') { if (lastStatus === 'successful') form.reset(); showForm(); } });
  $('pay-result-retry').addEventListener('click', showForm);
  $('pay-result-check').addEventListener('click', async () => {
    if (!lastOrderId) return;
    const btn = $('pay-result-check');
    btn.disabled = true;
    try {
      const r = await fetch(`/api/payments/status/${encodeURIComponent(lastOrderId)}`, { cache: 'no-store', credentials: 'same-origin' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not check the status.');
      show(data);
    } catch (e) { $('pay-result-msg').textContent = e.message; } finally { btn.disabled = false; }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const method = (form.querySelector('input[name="pay_gateway"]:checked') || {}).value;
    if (MANUAL[method]) return applyMethod(); // never simulate a payment for manual methods
    const payload = {
      plan: planSel.value,
      amount: amountEl.value.trim(), // display value only: the server uses its own price and rejects a mismatch
      reference: refEl.value.trim().toUpperCase(),
      name: $('pay-modal-name').value.trim(),
      email: $('pay-modal-email').value.trim(),
      phone: $('pay-modal-phone').value.trim(),
      method,
    };
    if (!refWrap.hidden && !payload.reference) return setError('Enter the payment reference you received from Vision-Tax.');
    if (!payload.amount) return setError(refWrap.hidden ? 'The price for this plan could not be loaded. Please refresh the page.' : 'Enter a valid payment reference to see the amount.');
    if (payload.name.length < 2) return setError('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) return setError('Enter a valid email address.');
    if (!phoneField) return setError('The phone field is still loading. Please refresh the page and try again.');
    const phoneCheck = phoneField.validate();
    if (!phoneCheck.ok) return setError(phoneCheck.error);
    payload.phone = phoneCheck.e164;
    payload.country = phoneCheck.country || phoneField.country();

    const label = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting secure checkout…';
    const restore = () => { submitBtn.innerHTML = label; applyMethod(); };
    let order;
    try {
      [order] = await Promise.all([post('order', payload), loadRazorpay()]);
    } catch (err) { restore(); return setError(err.message); }
    restore();
    lastOrderId = order.orderId;

    let settled = false;
    let failure = null;
    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'Vision-Tax',
      description: order.description,
      prefill: order.prefill,
      theme: { color: '#d9a900' },
      handler: async (resp) => {
        settled = true;
        try { show(await post('verify', resp)); } catch (err) {
          // Could not reach our server to verify: do NOT claim success; let the user re-check.
          show({ status: 'pending', message: 'We could not confirm your payment yet. Please check the status in a moment.', orderId: order.orderId, amount: (order.amount / 100).toFixed(2), currency: order.currency });
        }
      },
      modal: {
        ondismiss: async () => {
          if (settled) return;
          settled = true;
          // The server asks Razorpay what actually happened; we never tell it the payment failed.
          try { show(await post(failure ? 'failure' : 'cancel', { razorpay_order_id: order.orderId })); } catch (err) { setError(err.message); }
        },
      },
    });
    rzp.on('payment.failed', (resp) => { failure = resp && resp.error ? resp.error : { description: 'Payment failed.' }; });
    rzp.open();
  });
}

/* ==========================================================================
   6d. Homepage QR code + UPI ID (managed from Admin → QR Code / UPI). Always read from the backend.
   ========================================================================== */
function initPaymentInfo() {
  const img = document.getElementById('pay-qr-img');
  if (!img) return;
  const empty = document.getElementById('pay-qr-empty');
  const upi = document.getElementById('pay-upi-text');
  const instr = document.getElementById('pay-qr-instruction');

  function render(info) {
    const hasQr = Boolean(info && info.qr && info.qr.url);
    if (hasQr) { if (img.getAttribute('src') !== info.qr.url) img.src = info.qr.url; } else img.removeAttribute('src');
    img.hidden = !hasQr;
    empty.hidden = hasQr;
    instr.hidden = !hasQr;
    upi.textContent = info && info.upi ? `UPI – ${info.upi}` : 'UPI ID not available';
  }
  // A missing/broken image must never show as a broken-image icon.
  img.addEventListener('error', () => render({ qr: null, upi: upi.dataset.upi || null }));

  async function load() {
    try {
      const r = await fetch('/api/public/payment-info', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error('bad status');
      const info = await r.json();
      upi.dataset.upi = info.upi || '';
      render(info);
    } catch { render(null); }
  }
  load();
  window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}



// Global password visibility toggle
window.togglePasswordVisibility = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    }
  } else {
    input.type = 'password';
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  }
};

/* ==========================================================================
   7. Contact Form Submission
   ========================================================================== */
function initContactForm() {
  const contactForm = document.getElementById('main-contact-form');
  if (!contactForm) return;

  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('Your message has been sent successfully! We will get in touch shortly.');
    contactForm.reset();
  });
}

/* ==========================================================================
   8. Global Toast Notification
   ========================================================================== */
function showToast(message) {
  let toast = document.querySelector('.toast-notice');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-notice';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #34d399;"></i> <span>${message}</span>`;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 4500);
}
