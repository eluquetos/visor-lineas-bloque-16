(() => {
  const routes = window.PIPELINE_DATA || [];
  const list = document.querySelector('#route-list');
  const select = document.querySelector('#route-select');
  const summary = document.querySelector('#route-summary');
  const dialog = document.querySelector('#station-dialog');
  const lineDialog = document.querySelector('#line-dialog');
  const toast = document.querySelector('#toast');
  const installButton = document.querySelector('#install-app');
  const installDialog = document.querySelector('#install-dialog');
  let active = routes[0];
  let group;
  let userMarker;
  let chosenStation;
  let satellite = true;
  let installPrompt;

  document.querySelector('#route-count').textContent = routes.length;

  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) document.documentElement.classList.add('standalone');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./service-worker.js');
  const appleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (appleMobile && !window.navigator.standalone) installButton.hidden = false;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
    } else {
      installDialog.showModal();
    }
  });
  document.querySelector('#install-close').addEventListener('click', () => installDialog.close());

  const map = L.map('map', { center: [-0.55, -76.35], zoom: 11, minZoom: 3, maxZoom: 22, zoomControl: false });
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '© OpenStreetMap'
  });
  const imagery = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&scale=2&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxNativeZoom: 19,
    maxZoom: 22,
    tileSize: 256,
    attribution: 'Imágenes © Google'
  }).addTo(map);

  const rad = value => value * Math.PI / 180;
  const segment = (a, b) => {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const length = lines => lines.reduce((total, line) => total + line.slice(1).reduce((sum, point, index) => sum + segment(line[index], point), 0), 0);
  const routeColors = {
    'cap-bog-agua': '#00d4ff',
    'cap-bog-fluido': '#ff6b7d',
    'npf-capiron': '#00ff88',
    'npf-tivacuno-a': '#b66cff',
    'tivacuno-c-a': '#ffb800'
  };
  const colorFor = route => routeColors[route.id] || route.color;
  const setTheme = route => {
    document.documentElement.style.setProperty('--route', colorFor(route));
    document.documentElement.style.setProperty('--soft', route.soft);
  };

  function toUtm(lat, lng) {
    const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
    const centralMeridian = rad((zone - 1) * 6 - 180 + 3);
    const latitude = rad(lat);
    const longitude = rad(lng);
    const a = 6378137;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const sinLat = Math.sin(latitude);
    const cosLat = Math.cos(latitude);
    const tanLat = Math.tan(latitude);
    const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const t = tanLat * tanLat;
    const c = ep2 * cosLat * cosLat;
    const aa = cosLat * (longitude - centralMeridian);
    const m = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latitude
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latitude)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latitude)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * latitude));
    const easting = k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * aa ** 5 / 120) + 500000;
    let northing = k0 * (m + n * tanLat * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * aa ** 6 / 720));
    if (lat < 0) northing += 10000000;
    return { zone: `${zone}${lat < 0 ? 'S' : 'N'}`, easting: Math.round(easting), northing: Math.round(northing) };
  }

  function showStation(station) {
    chosenStation = station;
    const utm = toUtm(station.lat, station.lng);
    document.querySelector('#station-name').textContent = station.name;
    document.querySelector('#station-route').textContent = active.code;
    document.querySelector('#station-lat').textContent = station.lat.toFixed(6);
    document.querySelector('#station-lng').textContent = station.lng.toFixed(6);
    document.querySelector('#station-zone').textContent = utm.zone;
    document.querySelector('#station-east').textContent = utm.easting.toLocaleString('es-EC');
    document.querySelector('#station-north').textContent = utm.northing.toLocaleString('es-EC');
    const description = document.querySelector('#station-description');
    description.textContent = station.description || 'Coordenadas tomadas del archivo KMZ.';
    dialog.showModal();
  }

  function showLineInfo() {
    document.querySelector('#line-name').textContent = active.code;
    document.querySelector('#line-code').textContent = `Código: ${active.code}`;
    const container = document.querySelector('#line-info-list');
    container.replaceChildren();
    if (!active.info?.length) {
      const empty = document.createElement('p');
      empty.className = 'line-empty';
      empty.textContent = 'No hay una fila asociada para esta línea en el archivo Excel.';
      container.append(empty);
    } else {
      active.info.forEach(field => {
        const item = document.createElement('div');
        const label = document.createElement('small');
        const value = document.createElement('strong');
        label.textContent = field.label;
        value.textContent = field.value;
        item.append(label, value);
        container.append(item);
      });
    }
    lineDialog.showModal();
  }

  function renderRoute(routeId) {
    active = routes.find(route => route.id === routeId) || routes[0];
    setTheme(active);
    group?.remove();
    group = L.featureGroup().addTo(map);
    active.lines.forEach(line => {
      L.polyline(line, { color: '#06111c', weight: 11, opacity: .92 }).addTo(group);
      L.polyline(line, { color: colorFor(active), weight: 5, opacity: 1 }).addTo(group);
    });
    active.stations.forEach(station => {
      const marker = L.circleMarker([station.lat, station.lng], { radius: 9, color: '#eaf7ff', weight: 3, fillColor: colorFor(active), fillOpacity: 1 }).addTo(group);
      marker.bindTooltip(station.name, { direction: 'top', offset: [0, -8], className: 'ep-label' });
      marker.on('click', () => showStation(station));
    });
    if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [42, 42], maxZoom: 16 });
    document.querySelector('#route-name').textContent = active.code;
    document.querySelector('#route-service').textContent = active.service;
    document.querySelector('#route-icon').textContent = active.service === 'Agua' ? '≋' : '⌁';
    document.querySelector('#route-length').textContent = `${length(active.lines).toFixed(2)} km`;
    document.querySelector('#station-count').textContent = active.stations.length;
    select.value = active.id;
    [...list.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === active.id)));
  }

  routes.forEach(route => {
    const button = document.createElement('button');
    button.className = 'route-card';
    button.dataset.id = route.id;
    button.style.setProperty('--route', colorFor(route));
    button.style.setProperty('--soft', route.soft);
    const symbol = document.createElement('span');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const service = document.createElement('small');
    const dot = document.createElement('i');
    symbol.className = 'symbol'; symbol.textContent = '⌁';
    title.textContent = route.code; service.textContent = route.service; dot.className = 'dot';
    copy.append(title, service); button.append(symbol, copy, dot);
    button.addEventListener('click', () => renderRoute(route.id));
    list.append(button);
    const option = document.createElement('option');
    option.value = route.id;
    option.textContent = `${route.code} · ${route.service}`;
    select.append(option);
  });
  select.addEventListener('change', event => renderRoute(event.target.value));
  document.querySelector('#zoom-in').addEventListener('click', () => map.zoomIn());
  document.querySelector('#zoom-out').addEventListener('click', () => map.zoomOut());
  document.querySelector('#fit-route').addEventListener('click', () => group && map.fitBounds(group.getBounds(), { padding: [42, 42], maxZoom: 16 }));
  document.querySelector('#line-info').addEventListener('click', showLineInfo);
  document.querySelector('#toggle-layer').addEventListener('click', () => {
    if (satellite) { map.removeLayer(imagery); streets.addTo(map); } else { map.removeLayer(streets); imagery.addTo(map); }
    satellite = !satellite;
  });
  document.querySelector('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return showToast('Este dispositivo no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      userMarker?.remove();
      userMarker = L.circleMarker([coords.latitude, coords.longitude], { radius: 10, color: '#fff', weight: 4, fillColor: '#1f72a3', fillOpacity: 1 }).addTo(map).bindTooltip('Tu ubicación');
      map.setView([coords.latitude, coords.longitude], 16);
    }, () => showToast('No fue posible obtener tu ubicación. Revisa el permiso de GPS.'), { enableHighAccuracy: true, timeout: 15000 });
  });
  function showToast(message) { toast.textContent = message; toast.hidden = false; setTimeout(() => toast.hidden = true, 5000); }
  document.querySelector('#dialog-close').addEventListener('click', () => dialog.close());
  document.querySelector('#line-close').addEventListener('click', () => lineDialog.close());
  document.querySelector('#station-center').addEventListener('click', () => { if (chosenStation) map.setView([chosenStation.lat, chosenStation.lng], 17); dialog.close(); });
  renderRoute(active.id);
})();
