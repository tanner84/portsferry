/* Source figures keyed by property ID; additional records can supply their own images. */
window.PF = window.PF || {};
PF.sourceImages = {
  records: {
    prop_peachtree_santee: [{
      title: 'Peachtree tract · location source',
      image: 'assets/sources/peachtree-altizer-figure-3.png',
      alt: 'Figure 3: USGS Santee quadrangle with the Peachtree tract outlined in red and a red site point.',
      citation: 'Kendanne M. Altizer, “Three Hoes in the Kitchen: The Conceptualization of Peachtree Plantation, St. James Santee Parish, South Carolina” (MS thesis, Clemson University, 2014), p. 4, fig. 3. Image courtesy of Sabine & Waters, Inc.; base map: U.S. Geological Survey.',
      url: 'https://tigerprints.clemson.edu/all_theses/2013',
      note: 'The figure shows the tract and site context. The map marker remains an approximate house-site reference derived from HABS SC-882 coordinates. This cropped figure has not been georeferenced independently; its red outline is not asserted as the plantation’s 1773 boundary.'
    }]
  },
  forProperty(property) { return property.source_images || this.records[property.prop_id] || []; },
  open(source) {
    if (PF.timeline?.playing) PF.timeline.pause();
    let dialog = document.getElementById('source-image-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'source-image-dialog';
      dialog.setAttribute('aria-labelledby', 'source-image-title');
      document.body.append(dialog);
    }
    dialog.replaceChildren();
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.id = 'source-image-title'; title.textContent = source.title;
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => dialog.close();
    header.append(title, close);
    const label = document.createElement('label'); label.textContent = 'Zoom ';
    const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = 100; zoom.max = 300; zoom.value = 100; zoom.step = 25; zoom.setAttribute('aria-label','Source image zoom');
    label.append(zoom);
    const viewport = document.createElement('div'); viewport.className = 'source-image-viewport';
    const image = document.createElement('img'); image.src = source.image; image.alt = source.alt;
    viewport.append(image); zoom.oninput = () => { image.style.width = zoom.value + '%'; image.style.height = Number(zoom.value) === 100 ? '54vh' : 'auto'; };
    const citation = document.createElement('p'); citation.textContent = source.citation;
    const note = document.createElement('p'); note.textContent = source.note;
    const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open full source';
    dialog.append(header, label, viewport, citation, note, link);
    dialog.showModal(); close.focus();
  }
};
