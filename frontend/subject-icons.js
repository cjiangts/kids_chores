// Subject identity tiles. Each subject has a default glyph + default tone.
// Tones are hardcoded for now; a future picker will store per-deck overrides
// and pass them via subjectIcon(id, {tone}).
//
// Each entry: { tone } plus either { label } (rendered as text) or { svg } (id from icons.js).

const SUBJECT_ICONS = {
    basic_math_facts:    { svg: 'subj-math-basic',    tone: 'blue'   },
    math_problems:       { svg: 'subj-math-advanced', tone: 'purple' },
    chinese_characters:  { label: '字',  tone: 'orange' },
    chinese_vocabulary:  { label: '词',  tone: 'red'    },
    chinese_writing:     { label: '写',  tone: 'green'  },
    chinese_reading:     { label: '读',  tone: 'amber'  },
    spelling:            { label: 'ABC', tone: 'teal',  multi: true },
};

// Order matters — this is the order a future color picker should display swatches in.
const SUBJECT_TONES = ['orange', 'red', 'amber', 'green', 'teal', 'blue', 'purple'];

// Render a subject tile. `size` (px) is optional:
//   - given: tile is sized via inline `--subj-size`; SVG inner uses px size
//   - omitted: tile size cascades from any ancestor that sets `--subj-size`
//     (or the CSS default of 48px); SVG inner scales to 80% of the tile so
//     the visible glyph weight matches text-label subjects (字, ABC).
function subjectIcon(id, opts) {
    const o = opts || {};
    const def = SUBJECT_ICONS[id];
    if (!def) return '';
    const tone   = o.tone || def.tone;
    const sizePx = o.size != null ? Math.max(16, Number(o.size)) : null;
    const multi  = def.multi ? ' subject-icon--multi' : '';
    const inner  = def.svg
        ? icon(def.svg, {
            size: sizePx ? Math.round(sizePx * 0.78) : '78%',
            strokeWidth: 2.4,
        })
        : (o.label || def.label);
    const styleAttr = sizePx ? ' style="--subj-size:' + sizePx + 'px"' : '';
    return '<div class="subject-icon subject-' + tone + multi + '"' + styleAttr + '>' + inner + '</div>';
}

if (typeof window !== 'undefined') {
    window.SUBJECT_ICONS = SUBJECT_ICONS;
    window.SUBJECT_TONES = SUBJECT_TONES;
    window.subjectIcon   = subjectIcon;
}
