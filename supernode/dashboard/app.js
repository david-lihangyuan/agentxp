// AgentXP Dashboard — Main JavaScript
// Dark theme, no framework, no innerHTML, vanilla JS only.
// CSP: script-src 'self' — no inline scripts.

(function () {
  'use strict';

  // ─── Utilities ────────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var elem = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') {
          elem.className = attrs[k];
        } else if (k === 'textContent') {
          elem.textContent = attrs[k];
        } else {
          elem.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (typeof c === 'string') {
          elem.appendChild(document.createTextNode(c));
        } else if (c) {
          elem.appendChild(c);
        }
      });
    }
    return elem;
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function fetchJSON(url, cb) {
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(cb)
      .catch(function (err) {
        console.error('Fetch error', url, err);
      });
  }

  // ─── Network Overview ─────────────────────────────────────────────────────

  function loadNetworkOverview() {
    var section = document.getElementById('network-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/network', function (data) {
      clearChildren(section);

      section.appendChild(el('h2', { textContent: 'Network Overview' }));

      var grid = el('div', { className: 'stat-grid' });

      var stats = [
        { label: 'Total Experiences', value: String(data.total_experiences) },
        { label: 'Total Agents', value: String(data.total_agents) },
        { label: 'Verification Rate', value: (data.verification_rate * 100).toFixed(1) + '%' },
        { label: 'Contributors', value: String(data.contributor_count) },
      ];

      stats.forEach(function (s) {
        var card = el('div', { className: 'stat-card' });
        card.appendChild(el('div', { className: 'stat-value', textContent: s.value }));
        card.appendChild(el('div', { className: 'stat-label', textContent: s.label }));
        grid.appendChild(card);
      });

      section.appendChild(grid);

      // Top tags
      if (data.top_tags && data.top_tags.length > 0) {
        section.appendChild(el('h3', { textContent: 'Top Tags' }));
        var tagList = el('div', { className: 'tag-list' });
        data.top_tags.forEach(function (t) {
          var tag = el('span', { className: 'tag' });
          tag.appendChild(el('span', { textContent: t.tag }));
          tag.appendChild(el('span', { className: 'tag-count', textContent: ' (' + t.count + ')' }));
          tagList.appendChild(tag);
        });
        section.appendChild(tagList);
      }
    });
  }

  // ─── Experience List ──────────────────────────────────────────────────────

  function loadExperienceList() {
    var section = document.getElementById('experience-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/experiences', function (data) {
      clearChildren(section);
      section.appendChild(el('h2', { textContent: 'All Experiences' }));

      if (!data.experiences || data.experiences.length === 0) {
        section.appendChild(el('p', { textContent: 'No experiences yet.' }));
        return;
      }

      var list = el('div', { className: 'experience-list' });

      data.experiences.forEach(function (exp) {
        var card = el('div', { className: 'experience-card' });

        var header = el('div', { className: 'experience-header' });
        header.appendChild(el('span', { className: 'experience-what', textContent: exp.what }));
        header.appendChild(el('span', { className: 'pulse-badge pulse-' + exp.pulse_state, textContent: exp.pulse_state }));
        card.appendChild(header);

        card.appendChild(el('div', { className: 'experience-outcome', textContent: 'Outcome: ' + exp.outcome }));
        card.appendChild(el('div', { className: 'experience-learned', textContent: exp.learned }));

        // Scope
        if (exp.scope) {
          var scopeEl = el('div', { className: 'experience-scope' });
          scopeEl.appendChild(document.createTextNode('Scope: ' + JSON.stringify(exp.scope)));
          card.appendChild(scopeEl);
        }

        // Relations (dialogue graph)
        if (exp.relations && exp.relations.length > 0) {
          var relSection = el('div', { className: 'experience-relations' });
          relSection.appendChild(el('strong', { textContent: 'Relations: ' }));
          exp.relations.forEach(function (r) {
            var relEl = el('span', { className: 'relation-badge relation-' + r.relation_type });
            relEl.textContent = r.direction + ':' + r.relation_type + ' #' + r.related_experience_id;
            relSection.appendChild(relEl);
          });
          card.appendChild(relSection);
        }

        list.appendChild(card);
      });

      section.appendChild(list);
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    loadNetworkOverview();
    loadExperienceList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
