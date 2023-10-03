'use strict';

{
  function setupTheme() {
    const kCustomPreference = 'customDarkTheme';
    const userSettings = sessionStorage.getItem(kCustomPreference);
    const themeToggleButton = document.getElementById('theme-toggle-btn');

    if (userSettings === null && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');

      if ('onchange' in mq) {
        function mqChangeListener(e) {
          document.documentElement.classList.toggle('dark-mode', e.matches);
        }
        mq.addEventListener('change', mqChangeListener);
        if (themeToggleButton) {
          themeToggleButton.addEventListener(
            'click',
            function() {
              mq.removeEventListener('change', mqChangeListener);
            },
            { once: true },
          );
        }
      }

      if (mq.matches) {
        document.documentElement.classList.add('dark-mode');
      }
    } else if (userSettings === 'true') {
      document.documentElement.classList.add('dark-mode');
    }

    if (themeToggleButton) {
      themeToggleButton.hidden = false;
      themeToggleButton.addEventListener('click', function() {
        sessionStorage.setItem(
          kCustomPreference,
          document.documentElement.classList.toggle('dark-mode'),
        );
      });
    }
  }

  function setupPickers() {
    function closeAllPickers() {
      for (const picker of pickers) {
        picker.parentNode.classList.remove('expanded');
      }

      window.removeEventListener('click', closeAllPickers);
      window.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        closeAllPickers();
      }
    }

    const pickers = document.querySelectorAll('.picker-header > a');

    for (const picker of pickers) {
      const parentNode = picker.parentNode;

      picker.addEventListener('click', function(e) {
        e.preventDefault();

        /*
          closeAllPickers as window event trigger already closed all the pickers,
          if it already closed there is nothing else to do here
        */
        if (parentNode.classList.contains('expanded')) {
          return;
        }

        /*
          In the next frame reopen the picker if needed and also setup events
          to close pickers if needed.
        */

        requestAnimationFrame(function() {
          parentNode.classList.add('expanded');
          window.addEventListener('click', closeAllPickers);
          window.addEventListener('keydown', onKeyDown);
        });
      });
    }
  }

  function setupStickyHeaders() {
    const header = document.querySelector('.header');
    let ignoreNextIntersection = false;

    new IntersectionObserver(
      function(e) {
        const currentStatus = header.classList.contains('is-pinned');
        const newStatus = e[0].intersectionRatio < 1;

        // Same status, do nothing
        if (currentStatus === newStatus) {
          return;
        } else if (ignoreNextIntersection) {
          ignoreNextIntersection = false;
          return;
        }

        /*
          To avoid flickering, ignore the next changes event that is triggered
          as the visible elements in the header change once we pin it.

          The timer is reset anyway after few milliseconds.
        */
        ignoreNextIntersection = true;
        setTimeout(function() {
          ignoreNextIntersection = false;
        }, 50);

        header.classList.toggle('is-pinned', newStatus);
      },
      { threshold: [1] },
    ).observe(header);
  }

  function setupAltDocsLink() {
    const linkWrapper = document.getElementById('alt-docs');

    function updateHashes() {
      for (const link of linkWrapper.querySelectorAll('a')) {
        link.hash = location.hash;
      }
    }

    addEventListener('hashchange', updateHashes);
    updateHashes();
  }

  function setupCopyButton() {
    const buttons = document.querySelectorAll('.copy-button');
    buttons.forEach((button) => {
      button.addEventListener('click', (el) => {
        const parentNode = el.target.parentNode;

        const flavorSelector = parentNode.querySelector('.js-flavor-selector');

        let code = '';

        if (flavorSelector) {
          if (flavorSelector.checked) {
            code = parentNode.querySelector('.mjs').textContent;
          } else {
            code = parentNode.querySelector('.cjs').textContent;
          }
        } else {
          code = parentNode.querySelector('code').textContent;
        }

        button.textContent = 'Copied';
        navigator.clipboard.writeText(code);

        setTimeout(() => {
          button.textContent = 'Copy';
        }, 2500);
      });
    });
  }

  function bootstrap() {
    // Check if we have JavaScript support.
    document.documentElement.classList.add('has-js');

    // Restore user mode preferences.
    setupTheme();

    // Handle pickers with click/taps rather than hovers.
    setupPickers();

    // Track when the header is in sticky position.
    setupStickyHeaders();

    // Make link to other versions of the doc open to the same hash target (if it exists).
    setupAltDocsLink();

    setupCopyButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
