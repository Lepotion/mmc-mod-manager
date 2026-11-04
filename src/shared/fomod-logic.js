// FOMOD installer rules, shared by the main process (which files to install) and the wizard UI.
// A selection is a Set of plugin ids "step:group:plugin".
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FomodLogic = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const pid = (s, g, p) => `${s}:${g}:${p}`;

  // dep = { op: 'And' | 'Or', items: [{ flag, value } | { file, state } | dep] }
  function evalDep(dep, flags, fileState) {
    if (!dep || !dep.items.length) return true;
    const res = dep.items.map((it) => {
      if (it.items) return evalDep(it, flags, fileState);
      if ('flag' in it) return (flags[it.flag] ?? '') === (it.value ?? '');
      if ('file' in it) return fileState(it.file) === it.state;
      return true;
    });
    return dep.op === 'Or' ? res.some(Boolean) : res.every(Boolean);
  }

  function pluginType(p, flags, fileState) {
    if (p.typePatterns) {
      for (const pt of p.typePatterns.patterns) if (evalDep(pt.dep, flags, fileState)) return pt.type || 'Optional';
      return p.typePatterns.default || 'Optional';
    }
    return p.type || 'Optional';
  }

  // Goes through steps in order; a step is visible if the flags set by earlier selections allow it.
  function walk(cfg, selected, fileState, upto = cfg.steps.length) {
    const flags = {};
    const visible = [];
    cfg.steps.forEach((st, s) => {
      if (s >= upto || !evalDep(st.visible, flags, fileState)) return;
      visible.push(s);
      st.groups.forEach((g, gi) => g.plugins.forEach((p, pi) => {
        if (selected.has(pid(s, gi, pi))) for (const f of p.flags) flags[f.name] = f.value;
      }));
    });
    return { flags, visible };
  }

  const stepVisible = (cfg, s, selected, fileState) => evalDep(cfg.steps[s].visible, walk(cfg, selected, fileState, s).flags, fileState);

  // Required + Recommended, and one option for groups that need one.
  function defaultsForStep(cfg, s, flags, fileState) {
    const ids = [];
    cfg.steps[s].groups.forEach((g, gi) => {
      const types = g.plugins.map((p) => pluginType(p, flags, fileState));
      let chosen = [];
      if (g.type === 'SelectAll') chosen = g.plugins.map((_, pi) => pi);
      else chosen = types.map((tp, pi) => (tp === 'Required' || tp === 'Recommended' ? pi : -1)).filter((pi) => pi >= 0);
      if (!chosen.length && (g.type === 'SelectExactlyOne' || g.type === 'SelectAtLeastOne')) {
        const pi = types.findIndex((tp) => tp !== 'NotUsable');
        if (pi >= 0) chosen = [pi];
      }
      if (g.type === 'SelectExactlyOne' || g.type === 'SelectAtMostOne') chosen = chosen.slice(0, 1);
      for (const pi of chosen) ids.push(pid(s, gi, pi));
    });
    return ids;
  }

  function autoSelect(cfg, fileState) {
    const selected = new Set();
    for (let s = 0; s < cfg.steps.length; s++) {
      const { flags } = walk(cfg, selected, fileState, s);
      if (!evalDep(cfg.steps[s].visible, flags, fileState)) continue;
      for (const id of defaultsForStep(cfg, s, flags, fileState)) selected.add(id);
    }
    return selected;
  }

  // Group rules: returns true when the selection in group `gi` of step `s` is acceptable.
  function groupValid(cfg, s, gi, selected) {
    const g = cfg.steps[s].groups[gi];
    const n = g.plugins.filter((_, pi) => selected.has(pid(s, gi, pi))).length;
    if (g.type === 'SelectExactlyOne') return n === 1;
    if (g.type === 'SelectAtMostOne') return n <= 1;
    if (g.type === 'SelectAtLeastOne') return n >= 1;
    return true;
  }

  // Files to install, lowest priority first so higher priorities overwrite.
  function filesFor(cfg, selected, fileState) {
    const { flags, visible } = walk(cfg, selected, fileState);
    const files = [...cfg.required];
    for (const s of visible) {
      cfg.steps[s].groups.forEach((g, gi) => g.plugins.forEach((p, pi) => {
        if (selected.has(pid(s, gi, pi))) files.push(...p.files);
      }));
    }
    for (const c of cfg.conditional) if (evalDep(c.dep, flags, fileState)) files.push(...c.files);
    return files.map((f, i) => ({ ...f, order: i })).sort((a, b) => a.priority - b.priority || a.order - b.order);
  }

  return { pid, evalDep, pluginType, walk, stepVisible, defaultsForStep, autoSelect, groupValid, filesFor };
});
