const catalogUrl = 'https://openrouter.ai/api/v1/models?input_modalities=text&output_modalities=text';
const freeRouter = { id: 'openrouter/free', name: 'Free Models Router' };
const maximumSuggestions = 8;

let models = [freeRouter];
let catalogState = 'idle';
let catalogRequest;

function loadModels() {
  if (catalogState === 'ready') return;
  if (catalogRequest) return catalogRequest;
  catalogState = 'loading';
  catalogRequest = fetch(catalogUrl, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  }).then(async response => {
    if (!response.ok) throw new Error('OpenRouter model list unavailable');
    const catalog = await response.json();
    const available = catalog.data.filter(model => typeof model?.id === 'string' && typeof model.name === 'string');
    models = [freeRouter, ...available.filter(model => model.id !== freeRouter.id)];
    catalogState = 'ready';
  }).catch(() => {
    catalogState = 'error';
  }).finally(() => {
    catalogRequest = undefined;
  });
  return catalogRequest;
}

export function setupModelPicker(picker) {
  const input = picker.querySelector('[data-model-input]');
  const options = picker.querySelector('[data-model-options]');
  const status = picker.querySelector('[data-model-status]');
  let matches = [];
  let active = -1;
  let dismissed = false;

  function setActive(index) {
    options.children[active]?.setAttribute('aria-selected', 'false');
    active = index;
    const option = options.children[active];
    if (option) {
      option.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    setActive(-1);
    options.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function choose(model) {
    input.value = model.id;
    close();
    status.textContent = `Selected ${model.name}.`;
  }

  function suggest() {
    const terms = input.value.trim().toLowerCase().split(/\s+/);
    matches = models.filter(({ name, id }) => {
      const label = `${name} ${id}`.toLowerCase();
      return terms.every(term => label.includes(term));
    }).slice(0, maximumSuggestions);

    setActive(-1);
    const items = matches.map((model, index) => {
      const item = document.createElement('li');
      item.id = `${options.id}-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      const name = document.createElement('strong');
      name.textContent = model.name;
      const detail = document.createElement('span');
      const free = model.id === freeRouter.id || model.id.endsWith(':free');
      detail.textContent = free ? `${model.id} · Free` : model.id;
      item.append(name, detail);
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => choose(model));
      return item;
    });
    options.replaceChildren(...items);
    options.hidden = matches.length === 0;
    input.setAttribute('aria-expanded', String(!options.hidden));

    if (catalogState === 'loading') status.textContent = 'Loading models…';
    else if (catalogState === 'error') status.textContent = 'Model suggestions are unavailable. You can still paste a full model ID.';
    else if (!matches.length) status.textContent = 'No matches. You can enter a full model ID.';
    else status.textContent = `${matches.length} model suggestions. Use the arrow keys to choose.`;
  }

  input.addEventListener('focus', async () => {
    dismissed = false;
    input.select();
    const pending = loadModels();
    suggest();
    if (!pending) return;
    await pending;
    if (document.activeElement === input && !dismissed) suggest();
  });
  input.addEventListener('input', () => {
    dismissed = false;
    suggest();
  });
  input.addEventListener('blur', () => {
    close();
    status.textContent = '';
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && (catalogState === 'loading' || !options.hidden)) {
      event.preventDefault();
      dismissed = true;
      close();
      status.textContent = '';
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0) choose(matches[active]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      dismissed = false;
      if (options.hidden) suggest();
      if (!matches.length) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? active + 1 : active - 1;
      setActive(Math.max(0, Math.min(next, matches.length - 1)));
    }
  });

  picker.querySelector('[data-model-reset]')?.addEventListener('click', () => choose(freeRouter));
}
