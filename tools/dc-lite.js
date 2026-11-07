/* dc-lite: запуск макетов design/project/*.dc.html в обычном браузере, без холста Claude Design.
   Понимает ровно то, чем пользуются макеты: <x-dc>, <helmet>, {{путь}} в тексте и атрибутах,
   <sc-for list as>, <dc-import name ...>, onClick/onChange, класс Component extends DCLogic
   с renderVals() и setState(). Компоненты (Tower) вшиты в страницу сборщиком tools/export-design.js:
   <script type="text/x-dc-template" data-name="Tower"> и <script type="text/x-dc-logic" data-name="Tower">. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
      this._redraw = null;
    }
    setState(patch) {
      Object.assign(this.state, patch);
      if (this._redraw) this._redraw();
    }
    renderVals() {
      return {};
    }
  }

  function textOf(selector) {
    var out = {};
    document.querySelectorAll(selector).forEach(function (s) {
      out[s.getAttribute('data-name')] = s.textContent;
    });
    return out;
  }

  var templates = textOf('script[type="text/x-dc-template"]');
  var logics = textOf('script[type="text/x-dc-logic"]');

  function makeClass(code) {
    if (!code) return DCLogic;
    var body = code + '\n;return typeof Component === "undefined" ? DCLogic : Component;';
    return new Function('DCLogic', body)(DCLogic);
  }

  var classes = {};
  function componentClass(name) {
    if (!classes[name]) classes[name] = makeClass(logics[name]);
    return classes[name];
  }

  function parseTemplate(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    var h = t.content.querySelector('helmet');
    if (h) h.remove();
    return t.content;
  }

  var EXPR = /\{\{\s*([\w$.]+)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([\w$.]+)\s*\}\}$/;

  function lookup(path, scope) {
    var cur = scope;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interpolate(str, scope) {
    return str.replace(EXPR, function (_, p) {
      var v = lookup(p, scope);
      return v == null ? '' : String(v);
    });
  }

  function child(scope, extra) {
    return Object.assign(Object.create(scope), extra);
  }

  function setAttrs(from, to, scope) {
    for (var i = 0; i < from.attributes.length; i++) {
      var a = from.attributes[i];
      var m = WHOLE.exec(a.value);
      if (/^on[a-z]+$/i.test(a.name) && m) {
        var fn = lookup(m[1], scope);
        if (typeof fn === 'function') to[a.name.toLowerCase()] = fn;
      } else if (a.name !== 'hint-placeholder-count') {
        to.setAttribute(a.name, a.value.indexOf('{{') >= 0 ? interpolate(a.value, scope) : a.value);
      }
    }
  }

  function build(node, scope, out) {
    if (node.nodeType === 3) {
      var txt = node.data.indexOf('{{') >= 0 ? interpolate(node.data, scope) : node.data;
      out.appendChild(document.createTextNode(txt));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var lm = WHOLE.exec(node.getAttribute('list') || '');
      var list = (lm && lookup(lm[1], scope)) || [];
      var as = node.getAttribute('as') || 'item';
      list.forEach(function (item) {
        var sub = {};
        sub[as] = item;
        node.childNodes.forEach(function (c) {
          build(c, child(scope, sub), out);
        });
      });
      return;
    }
    if (tag === 'dc-import') {
      var props = {};
      for (var i = 0; i < node.attributes.length; i++) {
        var a = node.attributes[i];
        if (a.name === 'name' || a.name === 'hint-size') continue;
        var m = WHOLE.exec(a.value);
        props[a.name] = m ? lookup(m[1], scope) : a.value;
      }
      renderComponent(node.getAttribute('name'), props, out);
      return;
    }
    var el = document.importNode(node, false);
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    setAttrs(node, el, scope);
    node.childNodes.forEach(function (c) {
      build(c, scope, el);
    });
    out.appendChild(el);
  }

  function renderComponent(name, props, out) {
    var html = templates[name];
    if (html == null) {
      var miss = document.createElement('div');
      miss.textContent = 'dc-lite: нет компонента ' + name;
      out.appendChild(miss);
      return;
    }
    var Cls = componentClass(name);
    var vals = new Cls(props).renderVals() || {};
    parseTemplate(html).childNodes.forEach(function (c) {
      build(c, vals, out);
    });
  }

  function mount() {
    var root = document.querySelector('x-dc');
    if (!root) return;
    var helmet = root.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (n) {
        document.head.appendChild(n);
      });
    }
    var codeEl = document.querySelector('script[data-dc-script]');
    var inst = new (makeClass(codeEl ? codeEl.textContent : ''))({});
    var tpl = document.createElement('template');
    Array.prototype.slice.call(root.childNodes).forEach(function (n) {
      if (n.localName !== 'helmet') tpl.content.appendChild(n);
    });
    root.style.display = 'contents';
    function draw() {
      var vals = inst.renderVals() || {};
      var out = document.createDocumentFragment();
      tpl.content.childNodes.forEach(function (c) {
        build(c, vals, out);
      });
      root.replaceChildren(out);
    }
    inst._redraw = draw;
    draw();
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
