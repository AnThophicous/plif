#!/usr/bin/env python3
"""Build the Sifr design expansion shard from a curated, typed seed taxonomy.

The generated JSON is runtime data. The seed taxonomy stays in this script so
the corpus can be regenerated deterministically and reviewed as code, while
retrieval never loads this authoring table into the model prompt.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "knowledge" / "design-concepts-expansion.json"


SOURCES = {
    "vam-arts-crafts": {
        "title": "V&A: Arts and Crafts — an introduction",
        "url": "https://www.vam.ac.uk/articles/arts-and-crafts-an-introduction",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "DESIGN_INSTITUTION",
        "checked_at": "2026-09-01",
        "claim": "Arts and Crafts connected making, material quality and a critique of industrial production.",
    },
    "vam-art-nouveau": {
        "title": "V&A: Art Nouveau — an international style",
        "url": "https://www.vam.ac.uk/articles/art-nouveau-an-international-style",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "DESIGN_INSTITUTION",
        "checked_at": "2026-09-01",
        "claim": "Art Nouveau used organic line, asymmetry and the integration of structure and decoration.",
    },
    "vam-art-deco": {
        "title": "V&A: An introduction to Art Deco",
        "url": "https://www.vam.ac.uk/articles/an-introduction-to-art-deco",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "DESIGN_INSTITUTION",
        "checked_at": "2026-09-01",
        "claim": "Art Deco translated modernity through geometric order, simplified forms and material spectacle.",
    },
    "vam-modernism": {
        "title": "V&A: What was Modernism?",
        "url": "https://www.vam.ac.uk/articles/what-was-modernism",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "DESIGN_INSTITUTION",
        "checked_at": "2026-09-01",
        "claim": "Modernism joined social, technological and formal change into new approaches to art and design.",
    },
    "bauhaus-archive": {
        "title": "Bauhaus-Archiv / Museum für Gestaltung",
        "url": "https://www.bauhaus.de/en/bauhaus-archiv/",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "DESIGN_INSTITUTION",
        "checked_at": "2026-09-01",
        "claim": "The Bauhaus archive documents the school's history and influence across art, architecture and design.",
    },
    "moma-de-stijl": {
        "title": "MoMA: De Stijl, 1917–1928",
        "url": "https://www.moma.org/documents/moma_catalogue_1798_300159061.pdf",
        "source_type": "MUSEUM_CATALOGUE",
        "authority": "MUSEUM_ARCHIVE",
        "checked_at": "2026-09-01",
        "claim": "De Stijl developed a reductive vocabulary of orthogonal structure, primary color and universal composition.",
    },
    "moma-swiss": {
        "title": "MoMA: The International Typographic Style",
        "url": "https://assets.moma.org/documents/moma_catalogue_2753_300299007.pdf",
        "source_type": "MUSEUM_CATALOGUE",
        "authority": "MUSEUM_ARCHIVE",
        "checked_at": "2026-09-01",
        "claim": "The Swiss tradition made grid, typography, photography and alignment carry information structure.",
    },
    "moma-constructivism": {
        "title": "MoMA: Constructivism collection and research route",
        "url": "https://www.moma.org/collection/terms/constructivism",
        "source_type": "MUSEUM_COLLECTION",
        "authority": "MUSEUM_ARCHIVE",
        "checked_at": "2026-09-01",
        "claim": "Constructivist graphic language joined geometric structure, photomontage and social communication.",
    },
    "met-art-history": {
        "title": "The Metropolitan Museum of Art: Heilbrunn Timeline of Art History",
        "url": "https://www.metmuseum.org/toah/",
        "source_type": "MUSEUM_ARCHIVE",
        "authority": "MUSEUM_ARCHIVE",
        "checked_at": "2026-09-01",
        "claim": "The Met timeline provides period and object context for historical visual languages.",
    },
    "web-design-museum": {
        "title": "Web Design Museum",
        "url": "https://www.webdesignmuseum.org/",
        "source_type": "DIGITAL_ARCHIVE",
        "authority": "SPECIALIST_ARCHIVE",
        "checked_at": "2026-09-01",
        "claim": "The archive preserves screenshots and context for changing web interface conventions.",
    },
    "apple-hig": {
        "title": "Apple Human Interface Guidelines",
        "url": "https://developer.apple.com/design/human-interface-guidelines/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "PLATFORM_OWNER",
        "checked_at": "2026-09-01",
        "claim": "Apple documents platform interaction, material and hierarchy conventions; platform language must not be misrepresented as a generic style.",
    },
    "material-3": {
        "title": "Material Design 3",
        "url": "https://m3.material.io/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "PLATFORM_OWNER",
        "checked_at": "2026-09-01",
        "claim": "Material provides an authored system of color, typography, components, motion and adaptive behavior.",
    },
    "fluent-2": {
        "title": "Fluent 2 Design System",
        "url": "https://fluent2.microsoft.design/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "PLATFORM_OWNER",
        "checked_at": "2026-09-01",
        "claim": "Fluent 2 describes Microsoft's design language and component guidance; it is not a synonym for frosted glass.",
    },
    "carbon": {
        "title": "IBM Carbon Design System",
        "url": "https://carbondesignsystem.com/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "PRODUCT_OWNER",
        "checked_at": "2026-09-01",
        "claim": "Carbon provides a system for enterprise product hierarchy, components, tokens and accessibility.",
    },
    "primer": {
        "title": "GitHub Primer",
        "url": "https://primer.style/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "PRODUCT_OWNER",
        "checked_at": "2026-09-01",
        "claim": "Primer documents a product-oriented system for dense, composable interfaces and contribution patterns.",
    },
    "uswds": {
        "title": "U.S. Web Design System",
        "url": "https://designsystem.digital.gov/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "GOVERNMENT_DESIGN_SYSTEM",
        "checked_at": "2026-09-01",
        "claim": "USWDS emphasizes accessible, trustworthy and reusable government service interfaces.",
    },
    "govuk": {
        "title": "GOV.UK Design System",
        "url": "https://design-system.service.gov.uk/",
        "source_type": "OFFICIAL_DESIGN_SYSTEM",
        "authority": "GOVERNMENT_DESIGN_SYSTEM",
        "checked_at": "2026-09-01",
        "claim": "GOV.UK documents content-first, accessible and task-focused public service patterns.",
    },
    "brutalist-websites": {
        "title": "Brutalist Websites archive",
        "url": "https://brutalistwebsites.com/",
        "source_type": "SPECIALIST_GALLERY",
        "authority": "SPECIALIST_SOURCE",
        "checked_at": "2026-09-01",
        "claim": "A visual reference route for contemporary raw-web and brutalist web experiments; examples require product-specific interpretation.",
    },
    "awwwards": {
        "title": "Awwwards: Websites of the day and digital craft archive",
        "url": "https://www.awwwards.com/",
        "source_type": "SPECIALIST_GALLERY",
        "authority": "SPECIALIST_SOURCE",
        "checked_at": "2026-09-01",
        "claim": "A contemporary visual reference archive for interaction, art direction and digital craft; not evidence of usability or maintainability.",
    },
}


PROFILES = {
    "historical-foundational": {
        "principles": ["historical grammar is an argument, not decoration", "translate the original constraint before borrowing its surface"],
        "grammar": ["repeatable formal relationships", "material or production logic is visible in the composition"],
        "type": ["typography follows the communication role", "display contrast is bounded by reading requirements"],
        "color": ["palette follows medium, culture or production context", "accent is subordinate to the governing structure"],
        "spacing": ["rhythm follows the medium's production logic", "grouping is intentional rather than evenly distributed"],
        "geometry": ["shape vocabulary is historically legible", "irregularity has a compositional cause"],
        "layout": ["layout expresses the movement's theory of order", "primary reading path survives translation to screen"],
        "surfaces": ["surface treatment is tied to material or print context", "digital effects are optional translation, not proof of authenticity"],
        "motion": ["motion is a contemporary translation layer", "historical stillness is preserved unless interaction needs continuity"],
        "interaction": ["affordances remain modern and explicit", "reference language never hides task state"],
    },
    "digital-language": {
        "principles": ["the language is a system of decisions rather than a moodboard", "product pressure outranks trend recognition"],
        "grammar": ["repeatable relationships create recognition", "one dominant contrast controls supporting treatments"],
        "type": ["type roles are explicit", "display character never degrades UI reading"],
        "color": ["color has semantic or compositional work", "chroma is budgeted instead of sprayed"],
        "spacing": ["density expresses task frequency", "negative space or compression is used with intent"],
        "geometry": ["geometry repeats with controlled exceptions", "radius and edge rules are named"],
        "layout": ["the primary task has a stable axis", "responsive recomposition is designed, not merely stacked"],
        "surfaces": ["material is used at a meaningful layer", "effects have a contrast and performance fallback"],
        "motion": ["motion explains causality or hierarchy", "frequent actions settle quickly"],
        "interaction": ["states remain legible without color or hover", "touch and keyboard have equal intent"],
    },
    "retro-digital": {
        "principles": ["the historical technology shapes the visual grammar", "nostalgia is specific rather than generic noise"],
        "grammar": ["visible constraints of the source medium", "repeated artifacts are controlled motifs"],
        "type": ["period cues are reserved for labels or display roles", "body text gets modern legibility"],
        "color": ["palette reflects display, print or network context", "effects do not replace state semantics"],
        "spacing": ["density recalls the medium without reproducing its defects", "content remains scannable"],
        "geometry": ["source-era primitives are combined with modern layout rules", "pixel or gloss cues have a bounded role"],
        "layout": ["content hierarchy remains current", "retro framing is separated from interaction mechanics"],
        "surfaces": ["texture or material points to a source technology", "fallback removes the artifact without losing structure"],
        "motion": ["period behavior informs timing or transition", "flicker and distortion are never required for completion"],
        "interaction": ["old metaphors are explained when unfamiliar", "keyboard and touch behavior remain conventional"],
    },
    "expressive": {
        "principles": ["expressive density still has a focal order", "collision is authored through a repeatable rule"],
        "grammar": ["motifs recur across layers", "contrast is staged between loud and quiet zones"],
        "type": ["display type is choreographed with content", "supporting text gets protected measure and contrast"],
        "color": ["chroma is grouped into a palette logic", "accent intensity is reserved for hierarchy"],
        "spacing": ["rest zones are part of the composition", "density changes at named narrative beats"],
        "geometry": ["irregular forms are bounded by alignment or scale", "overlap has ownership and hit-area rules"],
        "layout": ["asymmetry directs attention", "mobile gets a deliberate crop/recomposition"],
        "surfaces": ["texture carries cultural or material meaning", "decoration cannot obscure interaction state"],
        "motion": ["entrances and transitions follow a choreographic score", "motion has an off switch and reduced-motion equivalent"],
        "interaction": ["surprise is limited to non-critical moments", "focus and recovery are more stable than the visual layer"],
    },
    "spatial": {
        "principles": ["space improves understanding, exploration or product evidence", "the non-spatial fallback is part of the experience"],
        "grammar": ["depth relationships are consistent", "camera, scale and occlusion carry information"],
        "type": ["text lives on a readable plane or layer", "spatial type never sacrifices contrast or selection"],
        "color": ["lighting and material are separated from semantic color", "state remains legible in flat fallback"],
        "spacing": ["depth is paced like information", "interaction targets remain generous in projected space"],
        "geometry": ["objects have an authored spatial role", "complexity is bounded by device and content budget"],
        "layout": ["camera choreography supports the narrative", "responsive changes include crop, controls and fallback"],
        "surfaces": ["material response supports recognition", "post-processing is optional and budgeted"],
        "motion": ["camera motion has a narrative cause", "idle motion pauses offscreen and under reduced motion"],
        "interaction": ["spatial affordances have a 2D equivalent", "pointer, touch, keyboard and screen reader paths remain explicit"],
    },
    "organic-generative": {
        "principles": ["variation follows a generative rule", "organic cues serve product meaning rather than decoration"],
        "grammar": ["continuity and local variation are bounded", "patterns have an observable input or process"],
        "type": ["display expression is isolated from reading copy", "generated distortion never affects essential text"],
        "color": ["palette follows environmental or data logic", "contrast is checked across generated states"],
        "spacing": ["flow is contained by readable regions", "density has a predictable limit"],
        "geometry": ["curves, particles or cells use a coherent field", "randomness is seeded or constrained"],
        "layout": ["the generated field supports a stable content layer", "responsive simplification is designed in"],
        "surfaces": ["texture or noise is tied to the process", "fallback preserves content and hierarchy"],
        "motion": ["animation follows a field or state transition", "CPU/GPU work is bounded and pausable"],
        "interaction": ["inputs alter a visible rule", "reduced motion and no-pointer paths remain meaningful"],
    },
    "graphic-treatment": {
        "principles": ["the image treatment clarifies tone or content", "the source medium is translated without copying a brand"],
        "grammar": ["marks, grain or crop rules repeat", "foreground and background maintain separation"],
        "type": ["treatment does not compromise text edges", "display pairing respects the image's visual weight"],
        "color": ["separation and reproduction logic guide color", "semantic state survives duotone or thresholding"],
        "spacing": ["crop and margin frame the image intentionally", "texture density does not crowd content"],
        "geometry": ["mark-making has a scale and orientation rule", "cut or pixel edges are deliberate"],
        "layout": ["image role is named: evidence, atmosphere or focal object", "content order survives art direction"],
        "surfaces": ["material cues are layered, not pasted on every element", "asset weight and decode cost are considered"],
        "motion": ["image change is tied to content or interaction", "animation does not create inaccessible shimmer"],
        "interaction": ["media controls remain recognizable", "alt text and non-image equivalents carry meaning"],
    },
    "color-material": {
        "principles": ["the color/material language is a role system", "contrast and semantics outrank palette fashion"],
        "grammar": ["roles have a stable luminance/chroma relationship", "material is assigned to meaningful surfaces"],
        "type": ["foreground roles are tested on worst-case surfaces", "display treatment never becomes the only contrast"],
        "color": ["color communicates hierarchy, state or atmosphere by explicit rule", "themes remap roles rather than invert blindly"],
        "spacing": ["material contrast helps grouping", "visual weight does not create false interaction"],
        "geometry": ["edge and radius laws support the material", "shine, blur or texture has a bounded region"],
        "layout": ["background treatment does not compete with task hierarchy", "content remains independent of chroma"],
        "surfaces": ["surface depth is semantic", "fallback removes effects while retaining contrast and grouping"],
        "motion": ["material response is subtle and causally linked", "no decorative animation in critical paths"],
        "interaction": ["selected, focus and disabled states are explicit", "color is never the only state signal"],
    },
    "composition": {
        "principles": ["composition is an information relationship", "the named system survives content variation"],
        "grammar": ["alignment, axis or field controls placement", "exceptions are authored rather than accidental"],
        "type": ["type scale follows the composition's focal logic", "annotations remain subordinate but readable"],
        "color": ["contrast reinforces grouping and route", "color is not used to hide structural ambiguity"],
        "spacing": ["rhythm expresses proximity and sequence", "edge behavior is defined at narrow widths"],
        "geometry": ["shape participates in grouping or direction", "hit areas remain independent of visual overlap"],
        "layout": ["the primary reading path is named", "responsive layout changes preserve intent, not coordinates"],
        "surfaces": ["layers clarify grouping or context", "effects do not substitute for layout"],
        "motion": ["movement follows the compositional axis", "recomposition is preferred over shrinking"],
        "interaction": ["focus order follows information order", "keyboard users get the same grouping cues"],
    },
    "domain-language": {
        "principles": ["domain trust and task consequence shape the interface", "domain language describes pressure, not a visual preset"],
        "grammar": ["hierarchy follows domain decisions and evidence", "content behavior is explicit"],
        "type": ["numerals, labels and reading copy get distinct roles", "tone never outranks comprehension"],
        "color": ["semantic color has a tested meaning", "brand chroma is separated from warning/state color"],
        "spacing": ["frequency and expertise determine density", "recovery and error space are intentional"],
        "geometry": ["controls reflect domain actions", "shape does not imitate a competitor's product"],
        "layout": ["primary job and secondary evidence are separated", "responsive behavior protects critical content"],
        "surfaces": ["surface hierarchy follows trust and context", "decoration is removable without losing meaning"],
        "motion": ["motion communicates progress or feedback", "high-consequence tasks settle and remain interruptible"],
        "interaction": ["keyboard, assistive tech and error recovery are first-class", "empty/loading/permission states are specified"],
    },
}


def make_seed(id_: str, name: str, category: str, era: str, focus: str, distinction: str, control: str, source: str, *aliases: str) -> dict:
    return {
        "id": id_,
        "canonical_name": name,
        "aliases": list(aliases),
        "category": category,
        "era_origin": era,
        "focus": focus,
        "distinction": distinction,
        "control": control,
        "source": source,
    }


SEEDS = [
    make_seed("arts-and-crafts", "Arts and Crafts", "historical-foundational", "1860s–1910s Britain and related workshops", "craft, material honesty and the dignity of making", "not a floral texture pack; its critique of industrial production matters", "show a material or making decision and remove ornamental repetition", "vam-arts-crafts", "Arts & Crafts"),
    make_seed("art-nouveau", "Art Nouveau", "historical-foundational", "1890s–1910s international movement", "organic line, integrated ornament and asymmetrical vitality", "not every botanical curve; structure and decoration are meant to cooperate", "keep the line system and content silhouette coherent across breakpoints", "vam-art-nouveau", "Jugendstil", "Modern Style"),
    make_seed("jugendstil", "Jugendstil", "historical-foundational", "1890s–1910s German-speaking Europe", "organic pattern joined to a more disciplined geometric structure", "distinct from a generic Art Nouveau label through its regional and graphic context", "pair ornamental line with a controlled modular or typographic scaffold", "vam-art-nouveau", "German Art Nouveau"),
    make_seed("vienna-secession", "Vienna Secession", "historical-foundational", "1897 onward Vienna", "decorative geometry, flat pattern and total-work coherence", "not identical to Art Nouveau; it often compresses organic motifs into geometric order", "repeat a small number of motifs across type, frame and surface", "vam-art-nouveau", "Secession style", "Wiener Secession"),
    make_seed("de-stijl", "De Stijl", "historical-foundational", "1917–1930s Netherlands", "universal order through orthogonal structure and restricted color", "not just a red-blue-yellow palette; the relational grid is the actual constraint", "let alignment and plane relationships carry the hierarchy before color", "moma-de-stijl", "Neoplasticism"),
    make_seed("suprematism", "Suprematism", "historical-foundational", "1910s–1920s Russian avant-garde", "non-objective geometry, tension and weightless spatial relations", "not abstract decoration; it suspends representation to foreground perception", "limit semantic content to a clear layer over a controlled field of tension", "met-art-history", "Suprematist geometry"),
    make_seed("russian-constructivism", "Russian Constructivism", "historical-foundational", "1910s–1930s Soviet avant-garde", "diagonal force, photomontage and communication for collective action", "not merely angular red graphics; social message and production logic are central", "use diagonals to direct a concrete action or evidence path", "moma-constructivism", "Constructivist graphics"),
    make_seed("futurism", "Futurism", "historical-foundational", "1909–1940s Italian and international avant-garde", "speed, simultaneity, industrial energy and typographic rupture", "not any high-energy diagonal; it is tied to modernity, machine culture and velocity", "reserve kinetic disruption for a narrative about change or movement", "met-art-history", "Futurist typography"),
    make_seed("dada", "Dada", "historical-foundational", "1916–1920s European avant-garde", "anti-rational collage, chance, satire and material discontinuity", "not random collage; the disruption is a critique or refusal", "name what convention is being interrupted before introducing mismatch", "met-art-history", "Dadaist graphics"),
    make_seed("new-typography", "New Typography", "historical-foundational", "1920s–1930s European graphic design", "functional type hierarchy, asymmetry and rejection of ornamental composition", "not simply sans-serif styling; information architecture drives form", "make scale, position and weight express the reading sequence", "moma-swiss", "Neue Typographie"),
    make_seed("ulm-school", "Ulm School", "historical-foundational", "1950s–1960s Ulm, Germany", "systematic design method, modular reasoning and social responsibility", "not a sterile grid aesthetic; method and use-context are the identity", "expose the decision system and test it against real task performance", "bauhaus-archive", "HfG Ulm"),
    make_seed("streamline-moderne", "Streamline Moderne", "historical-foundational", "1930s–1940s international industrial design", "aerodynamic horizontal flow, optimism and mass-produced modernity", "not Art Deco with rounded corners; motion and industrial production are its cues", "use horizontal flow where it clarifies progression, not as surface striping", "vam-art-deco", "Streamline"),
    make_seed("modernism", "Modernism", "historical-foundational", "late 19th century–mid 20th century", "function, new materials, social purpose and formal reduction", "not a single look; it is a family of responses to industrial and social change", "state the product problem the reduction is solving", "vam-modernism", "Modernist design"),
    make_seed("atomic-age", "Atomic Age", "historical-foundational", "1940s–1960s United States and Europe", "scientific optimism, orbital motifs and material futurity", "not generic space decoration; it reflects postwar technology and consumer imagination", "separate historical optimism from present-day scientific claims", "met-art-history", "Atomic design era"),
    make_seed("space-age", "Space Age", "historical-foundational", "1950s–1970s international design", "radical forms, new materials and speculative mobility", "distinct from Atomic Age through emphasis on exploration and manufactured futurity", "let an unusual form support an interaction or product narrative", "vam-modernism", "Space Age design"),
    make_seed("pop-art", "Pop Art", "historical-foundational", "1950s–1970s Britain and United States", "mass media, repetition, consumer imagery and high contrast", "not just bright color; repetition and appropriation of popular signs do the work", "repeat a recognizable motif while keeping content ownership and licensing clear", "met-art-history", "Pop graphics"),
    make_seed("op-art", "Op Art", "historical-foundational", "1960s international visual culture", "optical vibration, pattern and perceptual instability", "not decorative stripes; the perceptual effect is the subject", "keep essential text and controls outside the vibrating field", "met-art-history", "Optical art"),
    make_seed("psychedelic-design", "Psychedelic Design", "historical-foundational", "1960s–1970s counterculture", "hallucinatory color, warped type and immersive pattern", "not neon gradients alone; distortion and cultural context matter", "bound distortion to expressive surfaces and preserve a calm reading route", "met-art-history", "Psychedelic graphics"),
    make_seed("postmodernism", "Postmodernism", "historical-foundational", "1970s–1990s international design", "plural references, irony, fragmentation and rejection of a single modern order", "not permission for arbitrary mismatch; references need a readable argument", "make the collision legible through hierarchy and repeated motifs", "vam-modernism", "Postmodern design"),
    make_seed("new-wave-typography", "New Wave Typography", "historical-foundational", "1970s–1980s California and international graphic culture", "typographic layering, punk energy and expressive distortion", "not general experimental type; it emerged from a specific rejection of Swiss neutrality", "protect copy hierarchy while letting one typographic rule break the grid", "moma-swiss", "New Wave graphics"),
    make_seed("punk-graphics", "Punk Graphics", "historical-foundational", "1970s–1980s music and DIY culture", "urgency, cut-and-paste contrast and anti-polish", "not a distressed filter; speed, authorship and cultural stance matter", "use roughness to expose a message or call to action, not to mask unfinished work", "met-art-history", "Punk design"),
    make_seed("diy-graphics", "DIY Graphics", "historical-foundational", "1970s onward independent publishing and community culture", "available tools, direct voice and reproducible authorship", "not simulated imperfection; production constraints should feel credible", "choose a limited production method and apply it consistently", "vam-arts-crafts", "DIY design"),
    make_seed("grunge-graphics", "Grunge Graphics", "historical-foundational", "1990s music and youth culture", "erosion, photocopy texture and anti-commercial attitude", "not any grain overlay; the surface should support a resistant voice", "keep texture localized so text, controls and evidence stay readable", "met-art-history", "Grunge design"),
    make_seed("japanese-graphic-modernism", "Japanese Graphic Modernism", "historical-foundational", "1950s onward Japanese graphic design", "quiet asymmetry, disciplined typography and hybrid cultural references", "not a vague 'Japanese minimalism' preset; context and editorial precision matter", "use restraint with one deliberate cultural or material signal", "moma-swiss", "Japanese modernist graphics"),
    make_seed("web-brutalism", "Web Brutalism", "digital-language", "2010s onward independent web culture", "raw browser structure, visible links and refusal of polished defaults", "not broken layout; structure remains intentional and usable", "expose the page's hierarchy while preserving focus, contrast and recovery", "brutalist-websites", "Brutalist web"),
    make_seed("anti-design", "Anti-design", "digital-language", "2010s onward digital culture", "deliberate friction, contradiction and rejection of default polish", "not random ugliness; the refusal should target a known convention", "keep critical actions conventional even when the frame is confrontational", "awwwards", "Anti design"),
    make_seed("raw-web", "Raw Web", "digital-language", "2010s onward independent web culture", "document-like HTML structure, low abstraction and direct navigation", "not an excuse for missing responsive or semantic behavior", "use browser primitives as visible identity while engineering the full state model", "brutalist-websites", "Raw website"),
    make_seed("quiet-ui", "Quiet UI", "digital-language", "contemporary product design", "reduced chrome, calm emphasis and low-interruption hierarchy", "not washed-out gray or hidden affordances", "make quietness come from hierarchy and spacing, never low contrast", "govuk", "Quiet interface"),
    make_seed("precision-ui", "Precision UI", "digital-language", "contemporary professional software", "measured geometry, explicit states and high signal-to-chrome ratio", "not a monochrome skin; precision includes behavior and data density", "specify alignment, state and keyboard laws before decoration", "carbon", "Precision interface"),
    make_seed("soft-minimalism", "Soft Minimalism", "digital-language", "contemporary product and brand design", "minimal hierarchy softened by humane type, warm surfaces or gentle depth", "not neumorphism by default; usability remains high contrast", "allow softness in material and tone while keeping edges and states crisp", "primer", "Soft minimal"),
    make_seed("warm-minimalism", "Warm Minimalism", "digital-language", "contemporary editorial and lifestyle products", "reduction with warm neutrals, humanist detail and tactile pacing", "not beige branding alone; warmth must alter type, image and rhythm", "use one human signal against a restrained structural system", "vam-modernism", "Warm minimal"),
    make_seed("luxury-minimalism", "Luxury Minimalism", "digital-language", "contemporary premium commerce and hospitality", "scarcity, proportion and material/content quality", "not thin serif plus empty space; value must be visible in evidence and craft", "spend complexity on content, crop and interaction polish before ornament", "apple-hig", "Premium minimalism"),
    make_seed("editorial-minimalism", "Editorial Minimalism", "digital-language", "contemporary publishing, portfolios and product storytelling", "strong reading measure, restrained fields and one authored point of view", "not a generic landing with oversized headings", "let content sequence and typography create the signature", "moma-swiss", "Minimal editorial"),
    make_seed("liquid-glass-functional", "Liquid Glass-inspired Material", "digital-language", "contemporary adaptive navigation and overlay surfaces", "functional translucency, environmental response and layered separation", "not a platform claim unless the native system is actually used", "confine it to floating/navigation layers and provide opaque contrast fallback", "apple-hig", "Liquid Glass", "Adaptive glass"),
    make_seed("frosted-surface", "Frosted Glass Surface", "digital-language", "contemporary web overlays and media controls", "blurred separation with bounded transparency", "not the same as adaptive platform material; it can be static glassmorphism", "test foreground contrast over every backdrop and remove blur when unsupported", "fluent-2", "Frosted UI", "Frosted glass"),
    make_seed("tactile-ui", "Tactile UI", "digital-language", "contemporary friendly tools and onboarding", "visible press, drag and surface response that explains physicality", "not soft shadows on every card; tactility belongs to interaction", "make state change legible in color, shape and motion together", "material-3", "Tactile interface"),
    make_seed("paper-ui", "Paper UI", "digital-language", "editorial, education and craft-oriented products", "paper metaphor, page rhythm and physical annotation", "not a texture placed behind a generic card stack", "use page/annotation relationships to improve reading and editing", "vam-arts-crafts", "Paper interface"),
    make_seed("layered-material", "Layered Material", "digital-language", "complex apps and adaptive surfaces", "explicit surface levels, occlusion and contextual elevation", "not arbitrary drop shadows; every layer has a role", "map flat, grouped, floating and modal levels before styling", "material-3", "Material layering"),
    make_seed("chrome-ui", "Chrome UI", "digital-language", "fashion, music and speculative product experiences", "reflective metal, hard highlights and industrial interface cues", "not a metallic gradient alone; reflection needs a material and lighting rule", "limit chrome to focal or control surfaces and retain flat fallback", "awwwards", "Chrome interface"),
    make_seed("holographic-ui", "Holographic UI", "digital-language", "speculative, cultural and entertainment experiences", "depth-dependent color separation, diffraction cues and projected information", "not every rainbow gradient; the illusion must imply light or projection", "separate decorative spectral treatment from semantic status color", "awwwards", "Holographic interface"),
    make_seed("iridescent-surface", "Iridescent Surface Language", "digital-language", "fashion, beauty and expressive product launches", "angle-dependent hue shift and pearlescent material cues", "not a multi-stop gradient used as a brand system", "use the surface to frame a real material or focal object", "awwwards", "Iridescent UI"),
    make_seed("modular-ui", "Modular UI", "digital-language", "systems with repeated content units", "composable modules with explicit span, priority and state", "not a grid of same-size cards", "let modules vary only when content hierarchy justifies it", "carbon", "Modular interface"),
    make_seed("cardless-ui", "Cardless UI", "digital-language", "content-first tools and editorial products", "grouping through typography, rules, spacing and alignment instead of containers", "not a flat surface with lost boundaries", "replace cards with named grouping cues and preserve scan paths", "govuk", "Cardless interface"),
    make_seed("content-first-ui", "Content-first UI", "digital-language", "publishing, education, documentation and knowledge products", "content hierarchy precedes control chrome", "not an excuse to omit navigation, actions or states", "derive components from reading and decision moments", "govuk", "Content first"),
    make_seed("high-density-productivity", "High-density Productivity UI", "digital-language", "operations, finance and expert tools", "scan speed, compact rhythm and keyboard efficiency", "not cramped dashboards or small unreadable type", "raise information density only with stable alignment and recovery", "carbon", "Dense productivity UI"),
    make_seed("command-center", "Command Center UI", "digital-language", "operations, observability, logistics and mission-critical monitoring", "status wall, alert hierarchy and rapid drill-down", "not a dark dashboard with many widgets", "prioritize actionability, severity and temporal context over ornament", "carbon", "Command centre"),
    make_seed("developer-tool-ui", "Developer-tool UI", "digital-language", "IDEs, consoles, code and infrastructure products", "technical density, traceability and reversible actions", "not terminal cosplay; syntax and task state need real support", "make logs, commands, diffs and failures readable under pressure", "primer", "Developer tools interface"),
    make_seed("ai-native-ui", "AI-native UI", "digital-language", "AI products and agent workflows", "uncertainty, provenance, intervention and progressive disclosure", "not chat bubbles wrapped around a conventional form", "show what is generated, editable, pending, sourced or uncertain", "primer", "AI native interface"),
    make_seed("conversational-ui", "Conversational UI", "digital-language", "assistant and support interactions", "turn-based intent with visible context, correction and completion", "not a message list that hides application state", "pair conversation with structured controls and a recoverable task model", "govuk", "Conversational interface"),
    make_seed("workspace-ui", "Workspace UI", "digital-language", "creative, collaborative and professional applications", "persistent context, tools, panels and user-owned arrangement", "not a marketing page with draggable cards", "define focus, docking, resize and keyboard ownership explicitly", "carbon", "Workspace interface"),
    make_seed("canvas-first-ui", "Canvas-first UI", "digital-language", "design, diagramming, mapping and creative tools", "direct manipulation on an open field with contextual controls", "not an infinite whiteboard without navigation or semantics", "make selection, zoom, viewport and keyboard commands observable", "primer", "Canvas interface"),
    make_seed("infinite-canvas", "Infinite Canvas", "digital-language", "whiteboards, maps, diagrams and spatial planning", "unbounded spatial arrangement with zoomable context", "not a giant div; navigation and content indexing are core", "provide minimap/search/keyboard routes and a bounded mobile mode", "primer", "Infinite workspace"),
    make_seed("variable-typography", "Variable Typography Language", "digital-language", "editorial, brand and responsive display systems", "continuous weight, width or optical axis as a compositional instrument", "not just using a variable font file; axis choices need semantic roles", "bind axes to hierarchy and test language coverage, wrapping and performance", "moma-swiss", "Variable type"),
    make_seed("microtypographic-ui", "Microtypographic UI", "digital-language", "dense professional and editorial interfaces", "numeral, punctuation, label and measure precision", "not tiny text; microtype is about clarity at the actual reading scale", "test numeric alignment, truncation, wrapping and localization", "carbon", "Microtypography"),
    make_seed("expressive-serif", "Expressive Serif", "digital-language", "editorial, culture and premium brand storytelling", "serif personality as a narrative voice", "not a serif applied to every role", "protect body/UI readability and make contrast serve content tone", "moma-swiss", "Display serif language"),
    make_seed("aqua-like-ui", "Aqua-like UI", "retro-digital", "early 2000s desktop and web interface culture", "wet highlights, translucent controls and friendly desktop affordances", "not current glass material; the source is skeuomorphic desktop optimism", "use cues for nostalgia while keeping controls semantically modern", "web-design-museum", "Aqua interface"),
    make_seed("desktop-metaphor", "Desktop Metaphor", "retro-digital", "1980s onward graphical computing", "documents, folders, windows and spatial work surfaces", "not a literal requirement for every productivity app", "use the metaphor only when object ownership and operations map clearly", "web-design-museum", "Desktop UI metaphor"),
    make_seed("flat-design", "Flat Design", "retro-digital", "2010s product and platform design", "reduction of texture and depth in favor of shape, color and typography", "not no hierarchy; flat interfaces need stronger spacing and contrast", "replace lost affordance with explicit state, grouping and motion", "material-3", "Flat UI"),
    make_seed("flat-2", "Flat 2.0", "retro-digital", "mid-2010s interface evolution", "flat foundations with restrained depth and layering", "not skeuomorphism returning wholesale", "use depth to explain grouping or priority, never as decoration", "material-3", "Flat 2.0"),
    make_seed("material-you", "Material You", "retro-digital", "2020s adaptive platform design", "personalized color roles, expressive shape and adaptive components", "not generic Material or arbitrary theming", "derive a semantic palette from context while preserving contrast and roles", "material-3", "Material 3 expressive"),
    make_seed("pixel-ui", "Pixel UI", "retro-digital", "8-bit onward game and digital culture", "discrete pixel geometry, limited palette and grid-aligned type", "not a pixel font pasted onto a modern layout", "keep the pixel grid in marks and feedback while body copy stays readable", "web-design-museum", "Pixel interface"),
    make_seed("retro-os", "Retro OS UI", "retro-digital", "1980s–2000s desktop operating systems", "window chrome, dialogs, menus and system status", "not a vague nostalgia filter; interaction metaphors carry the reference", "use chrome as framing and keep modern keyboard semantics", "web-design-museum", "Retro operating system"),
    make_seed("crt-interface", "CRT Interface", "retro-digital", "late 20th-century display culture", "scanline, phosphor, bloom and low-resolution display behavior", "not gratuitous distortion; CRT is a display model", "isolate artifacts from copy and provide a crisp fallback", "web-design-museum", "CRT UI", "Terminal display"),
    make_seed("y2k", "Y2K", "retro-digital", "late 1990s–early 2000s design culture", "digital optimism, chrome, translucent plastic and speculative consumer tech", "not every chrome gradient; it is tied to a turn-of-millennium mood", "combine one era cue with a present product hierarchy", "web-design-museum", "Y2K design"),
    make_seed("cyber-y2k", "Cyber Y2K", "retro-digital", "late 1990s–early 2000s digital subculture", "network futurism, chrome, terminal cues and high-energy display type", "not equivalent to cyberpunk; it is more consumer-tech and internet-utopian", "keep neon and chrome as a bounded layer around a readable task", "web-design-museum", "Cyber Y2K"),
    make_seed("frutiger-aero", "Frutiger Aero", "retro-digital", "mid-2000s consumer software and advertising", "nature, glass, glossy icons and optimistic technology", "not a green-blue palette; ecological imagery and glossy interfaces form the tension", "avoid false sustainability claims and keep imagery purposeful", "web-design-museum", "Frutiger Aero"),
    make_seed("frutiger-metro", "Frutiger Metro", "retro-digital", "late 2000s–early 2010s interface culture", "cleaner flat panels mixed with friendly glossy nature motifs", "not Metro or Frutiger Aero alone; it is a hybrid transitional language", "use one transition cue and avoid visual ambiguity in controls", "web-design-museum", "Frutiger Metro"),
    make_seed("frutiger-eco", "Frutiger Eco", "retro-digital", "2000s sustainability communication", "optimistic environmental imagery with polished digital framing", "not evidence of ecological responsibility; image language can greenwash", "separate atmosphere from claims and provide concrete product evidence", "web-design-museum", "Frutiger Eco"),
    make_seed("vaporwave", "Vaporwave", "retro-digital", "2010s internet subculture", "commercial nostalgia, synthetic gradients, ruins and slowed digital memory", "not Synthwave; its critique and nostalgic material are different", "use appropriation carefully and keep cultural signs legible", "web-design-museum", "Vaporwave design"),
    make_seed("synthwave", "Synthwave", "retro-digital", "2010s retro-futurist music culture", "neon horizon, sunset gradient and cinematic electronic motion", "not Vaporwave; it celebrates a more coherent imagined future", "anchor the palette to a focal route and protect foreground contrast", "web-design-museum", "Synth wave"),
    make_seed("outrun", "Outrun", "retro-digital", "2010s retro-futurist visual culture", "speed, horizon lines, grids and car/arcade spectacle", "not all 1980s neon; motion and road-space metaphors are specific", "use direction and pacing as the signature, not only color", "web-design-museum", "OutRun"),
    make_seed("internet-nostalgia", "Internet Nostalgia", "retro-digital", "early web to social-web memory", "remembered interfaces, vernacular artifacts and personal digital history", "not a single visual style; the reference must be situated", "name the period and preserve a usable modern route", "web-design-museum", "Web nostalgia"),
    make_seed("old-web-maximalism", "Old-web Maximalism", "retro-digital", "1990s–2000s personal web culture", "dense links, animated motifs, badges, backgrounds and self-expression", "not uncontrolled clutter; personal-web density had navigational conventions", "bound the field with strong grouping and a readable primary path", "web-design-museum", "Personal web aesthetic"),
    make_seed("controlled-chaos", "Controlled Chaos", "expressive", "contemporary expressive art direction", "high variation contained by hierarchy, rhythm and motif", "not an excuse for random components", "write the constraints that make the chaos repeatable", "awwwards", "Structured chaos"),
    make_seed("collage", "Collage", "expressive", "20th century avant-garde to contemporary digital design", "heterogeneous fragments joined into a new reading", "not arbitrary layering; juxtaposition must create meaning", "assign each fragment a role and a crop boundary", "met-art-history", "Digital collage"),
    make_seed("photomontage", "Photomontage", "expressive", "1910s onward political and editorial graphics", "constructed image through cut, scale and contradiction", "not a collage synonym; photographic assembly and editorial argument matter", "make image relationships serve a claim or narrative", "moma-constructivism", "Photo montage"),
    make_seed("scrapbook", "Scrapbook", "expressive", "vernacular craft and contemporary editorial culture", "annotated fragments, memory, personal marks and collected evidence", "not random stickers; personal sequence and trace are the structure", "use annotation to reveal context, not obscure the primary task", "vam-arts-crafts", "Scrapbook design"),
    make_seed("sticker-aesthetic", "Sticker Aesthetic", "expressive", "contemporary youth, creator and campaign culture", "portable marks, outlined graphics and layered labels", "not a sticker on every control", "reserve stickers for calls, categories or personality beats", "awwwards", "Sticker design"),
    make_seed("neo-psychedelia", "Neo-psychedelia", "expressive", "contemporary music and culture graphics", "fluid distortion, saturated chroma and altered perception", "not retro psychedelic repetition; digital deformation is part of the language", "keep essential text in a stable layer and seed the visual variation", "awwwards", "Neo psychedelic"),
    make_seed("acid-graphics", "Acid Graphics", "expressive", "1990s rave and contemporary revival", "fluorescent contrast, warped forms and visual discomfort", "not simply neon; the abrasive edge is intentional", "give the abrasive layer a limited surface and a quiet reading route", "awwwards", "Acid design"),
    make_seed("rave-graphics", "Rave Graphics", "expressive", "1980s–1990s club culture and contemporary music", "frequency, repetition, modular type and high-energy composition", "not nightlife as a color palette; event information must still scan", "treat time, venue and CTA as protected data", "met-art-history", "Rave design"),
    make_seed("club-nightlife", "Club / Nightlife", "expressive", "contemporary music and venue culture", "dark atmosphere, invitation, urgency and social energy", "not dark premium; nightlife can be loud, crowded and temporal", "let event facts win over mood when decisions are time-sensitive", "awwwards", "Nightlife design"),
    make_seed("festival-graphics", "Festival Graphics", "expressive", "event and cultural programming", "many acts or themes organized into a visible identity system", "not maximalism without a schedule model", "build a content index before layering expressive treatments", "awwwards", "Festival design"),
    make_seed("streetwear", "Streetwear Editorial", "expressive", "contemporary fashion and youth culture", "drop urgency, vernacular type, product crop and cultural signal", "not generic fashion editorial; commerce and community pressure coexist", "make stock, size and purchase paths as strong as the campaign voice", "awwwards", "Streetwear design"),
    make_seed("urban-editorial", "Urban Editorial", "expressive", "contemporary culture, city and media storytelling", "documentary image, hard type and layered context", "not a city-photo theme; evidence and voice need a relationship", "use captions, dates and source context as compositional anchors", "met-art-history", "Urban editorial"),
    make_seed("pop-maximalism", "Pop Maximalism", "expressive", "contemporary consumer and campaign design", "high chroma, iconic motifs and direct emotional appeal", "not every bright marketing page; repetition and audience energy are specific", "choose a small motif vocabulary and a clear rest rhythm", "awwwards", "Pop maximalism"),
    make_seed("pattern-heavy", "Pattern-heavy Design", "expressive", "textile, lifestyle, culture and campaign products", "repetition and surface rhythm as identity", "not background noise; pattern needs scale and interruption rules", "keep pattern away from reading-critical zones or tune its contrast", "vam-arts-crafts", "Pattern design"),
    make_seed("memphis-revival", "Memphis Revival", "expressive", "contemporary playful product and culture design", "geometric ornament, saturated accents and ironic 1980s reference", "not the existing Memphis movement record; this is its contemporary translation", "limit shapes to a system and keep content hierarchy calmer than the frame", "met-art-history", "Neo-Memphis"),
    make_seed("retro-futurism", "Retro-futurism", "expressive", "20th century future imaginaries revisited", "past visions of future technology and optimistic infrastructure", "not generic sci-fi; the temporal mismatch is the subject", "name the source era and avoid false technical authority", "met-art-history", "Retro futurism"),
    make_seed("neo-futurism", "Neo-futurism", "expressive", "contemporary speculative architecture and product culture", "forward geometry, engineered surfaces and present-tense technology", "not retro-futurism; it imagines the future from current materials", "pair spectacle with a credible interaction or product proof", "vam-modernism", "Neo futurism"),
    make_seed("biopunk", "Biopunk", "expressive", "contemporary speculative culture", "biology, mutation, laboratory material and contested technology", "not cyberpunk with green accents; biological consequence changes the story", "separate fictional atmosphere from real health/science claims", "met-art-history", "Bio-punk"),
    make_seed("techno-language", "Techno Visual Language", "expressive", "electronic music, infrastructure and contemporary digital culture", "rhythmic grids, technical marks and machine-time", "not generic cyberpunk; rhythm and system notation are central", "make the rhythm support navigation or content sequence", "awwwards", "Techno design"),
    make_seed("3d-first", "3D-first Composition", "spatial", "contemporary product, entertainment and immersive web", "object, camera and depth lead the experience", "not a decorative 3D hero; the object must explain or persuade", "require a useful 2D fallback before committing to scene complexity", "awwwards", "3D first"),
    make_seed("spatial-web", "Spatial Web", "spatial", "emerging web and mixed-reality discourse", "information arranged through navigable space", "not a 3D background; spatial relationships are the information model", "define spatial anchors and a linear route for non-spatial users", "apple-hig", "Spatial interface"),
    make_seed("immersive-web", "Immersive Web", "spatial", "contemporary WebXR and experiential storytelling", "presence, exploration and responsive environment", "not full-screen motion theater; the user must retain orientation and control", "design entry, exit, pause and fallback as first-class states", "apple-hig", "Immersive interface"),
    make_seed("webgl-first", "WebGL-first Experience", "spatial", "interactive graphics and creative coding", "GPU-rendered visual field as the primary medium", "not any canvas effect; WebGL adds lifecycle and compatibility obligations", "budget context loss, DPR, fallback and offscreen pause", "awwwards", "WebGL experience"),
    make_seed("interactive-product", "Interactive Product Experience", "spatial", "commerce and product storytelling", "object manipulation as evidence of form, material or configuration", "not a spin animation without product information", "tie camera and interaction to decisions the buyer needs to make", "apple-hig", "Interactive product"),
    make_seed("product-3d", "Product 3D", "spatial", "commerce, industrial and luxury product experiences", "accurate object view, material and detail inspection", "not image decoration; model fidelity and asset licensing matter", "state what is approximate and keep product facts available outside the model", "apple-hig", "3D product viewer"),
    make_seed("virtual-exhibition", "Virtual Exhibition", "spatial", "museum, gallery and cultural institutions", "curated sequence, spatial rooms and contextual interpretation", "not a gallery of floating images; curatorial order and metadata matter", "offer a reading list, captions and low-bandwidth route", "met-art-history", "Virtual museum"),
    make_seed("digital-twin", "Digital Twin Interface", "spatial", "industrial, scientific and operational products", "spatial model tied to live or recorded system state", "not an illustrative 3D model; data provenance and update semantics matter", "show freshness, uncertainty and non-spatial data views", "carbon", "Digital twin"),
    make_seed("game-like-ui", "Game-like UI", "spatial", "education, entertainment and playful products", "feedback loops, progression and spatial affordance", "not gamification of every workflow", "keep goals, failure, pause and accessibility explicit", "material-3", "Game interface"),
    make_seed("diegetic-ui", "Diegetic UI", "spatial", "games, simulations and narrative experiences", "controls exist inside the represented world", "not a HUD placed over a scene; diegetic controls have world context", "provide a parallel accessible control route and readable scale", "apple-hig", "Diegetic interface"),
    make_seed("non-diegetic-ui", "Non-diegetic Game UI", "spatial", "games, dashboards and immersive media", "information floats outside the represented world for clarity", "not diegetic UI; it prioritizes legibility over fiction", "use stable screen-space anchors and preserve focus order", "material-3", "Screen-space game UI"),
    make_seed("isometric-ui", "Isometric UI", "spatial", "planning, games, diagrams and product maps", "constant-angle depth with readable topological relationships", "not any angled card; a consistent projection is required", "keep labels and controls screen-readable at every zoom", "met-art-history", "Isometric interface"),
    make_seed("diorama", "Diorama Composition", "spatial", "storytelling, product and cultural experiences", "small contained world with authored scale and framing", "not a miniature scene for its own sake", "make the frame reveal a relationship the flat page cannot", "met-art-history", "Diorama web"),
    make_seed("miniature-world", "Miniature World", "spatial", "playful brands, education and narrative products", "small-scale world used for orientation and exploration", "not a synonym for diorama; user traversal and discovery are more active", "cap complexity and give direct shortcuts to every key destination", "awwwards", "Miniature environment"),
    make_seed("depth-first-composition", "Depth-first Composition", "spatial", "immersive editorial and product storytelling", "foreground, middle-ground and background carry distinct roles", "not arbitrary parallax layers", "assign semantic ownership to each depth plane and flatten gracefully", "apple-hig", "Depth-led composition"),
    make_seed("parallax-led", "Parallax-led Storytelling", "spatial", "editorial, campaign and product narratives", "relative motion reveals sequence or focus", "not a scroll gimmick; parallax must clarify temporal or spatial relation", "freeze or simplify under reduced motion and small screens", "awwwards", "Parallax narrative"),
    make_seed("camera-driven-storytelling", "Camera-driven Storytelling", "spatial", "cinematic product and editorial experiences", "camera changes replace page jumps with authored viewpoint", "not slow scrolling or forced motion", "give the user control and a textual progression model", "awwwards", "Camera choreography"),
    make_seed("organic-design", "Organic Design", "organic-generative", "contemporary human-centered products and brands", "natural curves, human rhythm and non-mechanical grouping", "not random blobs or wellness shorthand", "tie organic form to content or material meaning", "vam-arts-crafts", "Organic interface"),
    make_seed("biomorphic", "Biomorphic Design", "organic-generative", "20th century modernism and contemporary product form", "forms derived from living bodies and growth", "not any rounded shape; biological reference affects proportion and continuity", "keep controls legible inside the soft form language", "vam-modernism", "Biomorphic UI"),
    make_seed("biophilic", "Biophilic Design Language", "organic-generative", "architecture, wellness and environmental products", "connection to living systems, daylight and natural material", "not green decoration or ecological claim", "distinguish environmental atmosphere from measurable sustainability", "vam-arts-crafts", "Biophilic interface"),
    make_seed("generative-design", "Generative Design", "organic-generative", "algorithmic design and parametric practice", "rule-based variation as an authored design method", "not randomly generated decoration", "expose input, seed, bounds and acceptable failure", "met-art-history", "Generative visual system"),
    make_seed("procedural-design", "Procedural Design", "organic-generative", "computational graphics and 3D workflows", "repeatable construction from parameters and operations", "not synonymous with generative art; procedural structure can serve utility", "make the parameter space testable and provide a deterministic fallback", "met-art-history", "Procedural visual system"),
    make_seed("algorithmic-visuals", "Algorithmic Visuals", "organic-generative", "creative coding and data-driven art", "calculation becomes visible form", "not every visualization; the algorithm may be expressive rather than explanatory", "state whether the output encodes data or atmosphere", "met-art-history", "Algorithmic graphics"),
    make_seed("generative-typography", "Generative Typography", "organic-generative", "experimental type and creative coding", "type form varies from rules, input or motion", "not animated headline effects; the generated letterform must remain readable", "freeze, simplify or replace the effect for essential copy", "moma-swiss", "Generative type"),
    make_seed("particle-visual-language", "Particle-based Visual Language", "organic-generative", "creative coding, scientific and spatial graphics", "many small units express flow, mass or emergence", "not a particle emitter pasted behind content", "give particles a field, density ceiling and semantic reason", "awwwards", "Particle design"),
    make_seed("flow-fields", "Flow Fields", "organic-generative", "generative art and data storytelling", "vector fields create directional motion and contour", "not generic moving lines; direction needs an input or visual thesis", "pause offscreen and keep a static field for reduced motion", "awwwards", "Flow field graphics"),
    make_seed("noise-driven-visuals", "Noise-driven Visuals", "organic-generative", "shader, texture and generative systems", "coherent irregularity from noise functions", "not random grain; scale and continuity are the distinction", "cap frequency and contrast so noise never competes with text", "awwwards", "Noise visuals"),
    make_seed("fluid-visuals", "Fluid Visuals", "organic-generative", "creative coding and expressive interfaces", "continuous deformation suggesting liquid or flow", "not every gradient animation; motion and interaction should imply fluid behavior", "provide a paused static state and bound simulation cost", "awwwards", "Fluid interface"),
    make_seed("voronoi-cellular", "Voronoi / Cellular Language", "organic-generative", "procedural graphics and scientific visualization", "cellular partition and local neighborhood structure", "not a polygon pattern without relational meaning", "use cell size and adjacency for a readable variable", "met-art-history", "Voronoi design"),
    make_seed("reaction-diffusion", "Reaction–diffusion Visuals", "organic-generative", "generative and scientific graphics", "growth, spots and pattern emergence from local interaction", "not organic texture by label; the formation rule is essential", "keep simulation bounded and provide a precomputed/static fallback", "met-art-history", "Reaction diffusion"),
    make_seed("flat-illustration", "Flat Illustration", "graphic-treatment", "20th century illustration to contemporary product design", "shape, plane and color communicate without modeled depth", "not a generic vector asset; flatness still needs composition and texture decisions", "use shape hierarchy and alt text rather than decorative detail", "met-art-history", "Flat illustration"),
    make_seed("geometric-illustration", "Geometric Illustration", "graphic-treatment", "modernist and contemporary visual communication", "constructed forms, modular shape and controlled abstraction", "not any illustration made of rectangles and circles", "let geometry explain the subject or brand constraint", "moma-swiss", "Geometric art"),
    make_seed("editorial-illustration", "Editorial Illustration", "graphic-treatment", "publishing and journalism", "metaphor, viewpoint and visual argument", "not decorative hero art; editorial illustration frames a claim", "give the illustration a caption/alt relationship and protect reading order", "met-art-history", "Editorial art"),
    make_seed("hand-drawn", "Hand-drawn Language", "graphic-treatment", "vernacular, education and contemporary brand design", "visible hand, irregular line and human pacing", "not a hand-drawn font everywhere", "use hand marks where human presence improves trust or approachability", "vam-arts-crafts", "Hand drawn design"),
    make_seed("sketch-language", "Sketch Language", "graphic-treatment", "process documentation and exploratory product narratives", "unfinished line as evidence of thinking", "not unpolished production UI", "confine sketch marks to ideation, annotation or invitation", "vam-arts-crafts", "Sketch aesthetic"),
    make_seed("line-art", "Line Art", "graphic-treatment", "illustration, diagram and icon culture", "contour, omission and stroke rhythm", "not every outline illustration; stroke hierarchy is the grammar", "normalize weight, joins and accessibility of informative lines", "moma-swiss", "Line illustration"),
    make_seed("engraving", "Engraving-inspired", "graphic-treatment", "printmaking and historical illustration", "crosshatch, incision and directional mark density", "not a generic vintage filter", "use hatching to describe form and preserve sufficient contrast", "met-art-history", "Engraved illustration"),
    make_seed("risograph", "Risograph Language", "graphic-treatment", "low-cost contemporary print and independent publishing", "limited spot colors, misregistration and grain", "not a duotone shortcut; reproduction behavior is part of the language", "keep ink layers limited and preserve text edge clarity", "vam-arts-crafts", "Riso graphics"),
    make_seed("screenprint", "Screenprint Language", "graphic-treatment", "poster, protest, fashion and independent publishing", "layered spot color, bold shape and reproducible ink logic", "not any flat poster; separations and overlap matter", "limit ink layers and preserve text edge clarity", "met-art-history", "Screen print"),
    make_seed("halftone", "Halftone Language", "graphic-treatment", "print, newspaper and contemporary image treatment", "continuous tone translated through a dot field", "not decorative dots; scale and sampling are the visual logic", "keep halftone out of small text and test high-DPI output", "met-art-history", "Halftone graphics"),
    make_seed("paper-texture", "Paper Texture", "graphic-treatment", "print, editorial and tactile brand design", "fibers, grain and substrate as a quiet material cue", "not a universal background overlay", "use a low-contrast texture with a content and performance budget", "vam-arts-crafts", "Paper grain"),
    make_seed("duotone", "Duotone Language", "color-material", "print and contemporary image systems", "two-channel color separation for mood and hierarchy", "not arbitrary two colors; tonal mapping is the decision", "preserve skin, product and semantic evidence through tested mappings", "met-art-history", "Duotone design"),
    make_seed("achromatic", "Achromatic System", "color-material", "modernist, editorial and professional products", "colorless field with luminance and material doing the hierarchy", "not low-contrast gray on gray", "reserve semantic chroma and test focus/disabled states", "moma-swiss", "Achromatic UI"),
    make_seed("high-contrast", "High Contrast Language", "color-material", "accessibility, information design and expressive graphics", "strong luminance or chroma separation", "not a theme toggle alone; contrast must hold across states and content", "test text, focus, controls, imagery and generated frames", "uswds", "High contrast design"),
    make_seed("low-contrast-editorial", "Low-contrast Editorial", "color-material", "fashion, luxury and contemplative editorial", "quiet tonal difference for atmosphere and reading pace", "not appropriate for controls or dense operations", "confine low contrast to non-critical surfaces and provide a strong text path", "apple-hig", "Low contrast design"),
    make_seed("muted-palette", "Muted Palette", "color-material", "editorial, wellness and professional products", "de-saturated color with controlled emphasis", "not dullness or disabled-looking actions", "separate calm surfaces from actionable contrast", "govuk", "Muted color system"),
    make_seed("pastel-system", "Pastel System", "color-material", "friendly consumer, education and lifestyle products", "light chroma and approachable grouping", "not pale text or insufficient contrast", "use dark semantic foregrounds and a higher-chroma action role", "material-3", "Pastel UI"),
    make_seed("earth-tone-system", "Earth-tone System", "color-material", "food, wellness, hospitality and environmental brands", "soil, mineral, plant and warm neutral relationships", "not a sustainability claim or generic beige", "connect color to actual material/content evidence", "vam-arts-crafts", "Earth tones"),
    make_seed("neon-system", "Neon System", "color-material", "nightlife, music, games and high-energy campaigns", "fluorescent accents against a controlled field", "not neon everywhere; intensity needs a hierarchy", "use neon for route/state/focal moments with readable fallback", "awwwards", "Neon interface"),
    make_seed("jewel-tone-system", "Jewel-tone System", "color-material", "luxury, culture and premium commerce", "deep saturated hues with material richness", "not dark mode plus random color", "keep tonal ladder and semantic roles distinct from brand accents", "vam-art-deco", "Jewel tones"),
    make_seed("color-blocking", "Color Blocking", "color-material", "fashion, editorial, education and campaigns", "large discrete color fields divide or direct content", "not a set of colorful cards", "use blocks to establish route, group or crop; keep typography on stable fields", "vam-art-deco", "Color block design"),
    make_seed("mesh-gradient", "Mesh Gradient", "color-material", "contemporary digital branding and expressive surfaces", "multi-point color field with local transitions", "not every gradient; a mesh has spatial color topology", "keep it ambient or material and test text over the worst luminance", "awwwards", "Mesh gradients"),
    make_seed("aurora-gradient", "Aurora Gradient", "color-material", "contemporary digital atmosphere and technology products", "soft luminous bands suggesting atmospheric light", "not a default modern background", "use as atmosphere behind a strong foreground system", "awwwards", "Aurora gradient"),
    make_seed("modular-grid", "Modular Grid", "composition", "print, editorial and interface systems", "repeated cells with controlled spans", "not a bento synonym; modular grids can be quiet and rigorous", "define span, gutter and content priority before filling cells", "moma-swiss", "Modular layout"),
    make_seed("column-grid", "Column Grid", "composition", "editorial, product and information design", "vertical alignment and measure through explicit columns", "not any two-column hero", "preserve reading measure and recompose columns at mid-widths", "moma-swiss", "Column layout"),
    make_seed("manuscript-grid", "Manuscript Grid", "composition", "books, longform editorial and reading products", "page margins, measure and a stable text block", "not a text column with arbitrary whitespace", "protect reading rhythm, notes and media insertion rules", "moma-swiss", "Manuscript layout"),
    make_seed("hierarchical-grid", "Hierarchical Grid", "composition", "editorial, campaign and complex content", "non-uniform regions sized by importance", "not broken alignment; hierarchy still has a shared logic", "document the priority that earns each span and test long content", "moma-swiss", "Hierarchical layout"),
    make_seed("baseline-grid", "Baseline Grid", "composition", "typography-led publishing and dense UI", "vertical rhythm anchored to text baselines", "not only a CSS line-height token", "align mixed type and controls without sacrificing responsive wrapping", "moma-swiss", "Baseline rhythm"),
    make_seed("asymmetric-grid", "Asymmetric Grid", "composition", "editorial, culture and expressive product design", "unequal columns create directional tension and hierarchy", "not misalignment or random offset", "keep one or more stable anchors across content lengths", "moma-swiss", "Asymmetrical grid"),
    make_seed("broken-grid", "Broken Grid", "composition", "fashion, culture and campaign art direction", "intentional departures from conventional alignment", "not a broken implementation", "name the break, keep hit areas stable and restore hierarchy nearby", "awwwards", "Broken layout"),
    make_seed("anti-grid", "Anti-grid", "composition", "experimental editorial and anti-design", "refusal of a visibly regular alignment system", "not absence of structure; proximity, sequence or type must still organize", "replace grid with another explicit organizing law", "brutalist-websites", "Anti-grid layout"),
    make_seed("axial-composition", "Axial Composition", "composition", "classical, editorial and information graphics", "content arranged around a dominant vertical or horizontal axis", "not centered text by default", "use the axis to establish sequence and reserve exceptions", "met-art-history", "Axial layout"),
    make_seed("radial-composition", "Radial Composition", "composition", "diagrams, campaigns and expressive interfaces", "content relates around a center or orbit", "not circular decoration; relationships must be navigable", "provide linear and keyboard equivalents for the radial route", "met-art-history", "Radial layout"),
    make_seed("diagonal-composition", "Diagonal Composition", "composition", "Constructivist, editorial and action-oriented graphics", "diagonal line directs energy and reading", "not slanted cards for drama", "tie the diagonal to movement, priority or transformation", "moma-constructivism", "Diagonal layout"),
    make_seed("layered-composition", "Layered Composition", "composition", "editorial, spatial and interface systems", "content planes overlap with explicit depth roles", "not stacked cards; overlap must communicate relation", "assign z-order, focus order and fallback order", "apple-hig", "Layered layout"),
    make_seed("overlapping-composition", "Overlapping Composition", "composition", "fashion, poster and expressive digital design", "objects cross boundaries to create figure/ground tension", "not overflow caused by sizing bugs", "clip only when intentional and keep semantic bounds visible", "awwwards", "Overlap layout"),
    make_seed("split-screen", "Split-screen Composition", "composition", "commerce, comparison and narrative landing pages", "two simultaneous fields create contrast or choice", "not two arbitrary columns", "give each pane a role and a mobile order", "moma-swiss", "Split screen"),
    make_seed("full-bleed", "Full-bleed Composition", "composition", "editorial, photography and campaign experiences", "media reaches the frame while text remains anchored", "not edge-to-edge everything", "use bleed for evidence or atmosphere and preserve text measure", "moma-swiss", "Full bleed"),
    make_seed("poster-layout", "Poster Layout", "composition", "graphic design, events and campaign pages", "one-frame hierarchy, large type and decisive placement", "not oversized type without information order", "treat the first viewport as a poster but provide document flow below", "vam-art-deco", "Poster-inspired web"),
    make_seed("sparse-field", "Sparse Field", "composition", "premium, contemplative and focused products", "few elements with measurable visual tension", "not emptiness used to hide missing content", "make every remaining element earn its space and test task completion", "moma-swiss", "Sparse composition"),
    make_seed("dense-information-wall", "Dense Information Wall", "composition", "operations, observability and data-rich products", "many simultaneous signals organized by severity and scan path", "not dashboard clutter", "use grouping, filtering and hierarchy before shrinking text", "carbon", "Information wall"),
    make_seed("dtc-commerce-language", "DTC Commerce Language", "domain-language", "direct-to-consumer product commerce", "promise, proof, product detail and low-friction purchase", "not a universal conversion template", "make trust, shipping, price and inventory visible near the decision", "primer", "DTC design"),
    make_seed("luxury-commerce-language", "Luxury Commerce Language", "domain-language", "premium fashion, beauty and hospitality commerce", "material evidence, scarcity and deliberate consideration", "not black-and-gold styling", "spend on image fidelity, copy confidence and service detail", "apple-hig", "Luxury commerce"),
    make_seed("marketplace-language", "Marketplace Language", "domain-language", "multi-seller commerce", "discovery, comparison, trust and seller context", "not a catalog grid alone", "separate platform trust from seller claims and preserve filtering", "carbon", "Marketplace UX language"),
    make_seed("fintech-language", "Fintech Language", "domain-language", "financial products and money movement", "trust, numbers, risk, permissions and clear confirmation", "not dark charts and green accents", "make state, fees, provenance and recovery explicit", "carbon", "Fintech design"),
    make_seed("healthcare-language", "Healthcare Language", "domain-language", "clinical, patient and health services", "safety, privacy, comprehension and human recovery", "not blue calmness as a substitute for clarity", "write for stress, variable expertise and assistive technology", "uswds", "Healthcare UX language"),
    make_seed("wellness-language", "Wellness Language", "domain-language", "wellness and habit products", "supportive progress, low pressure and embodied routine", "not pastel lifestyle decoration", "avoid shame loops and make pause/skip/recovery visible", "govuk", "Wellness design"),
    make_seed("food-restaurant-language", "Food / Restaurant Language", "domain-language", "food, restaurant and beverage products", "appetite, menu hierarchy, availability and local context", "not photography-first if ordering information is hidden", "let price, dietary information and order status stay scannable", "awwwards", "Food UX"),
    make_seed("automotive-language", "Automotive Experience Language", "domain-language", "vehicle and mobility products", "material, performance, configuration and confidence", "not cinematic car imagery without specification access", "pair spectacle with comparison and practical ownership information", "apple-hig", "Automotive design"),
    make_seed("real-estate-language", "Real Estate Language", "domain-language", "property search and development", "place, trust, spatial evidence and qualification", "not a photo gallery without location/data", "make map, floorplan, price and next action coherent", "govuk", "Real estate UX"),
    make_seed("travel-hospitality-language", "Travel / Hospitality Language", "domain-language", "travel, hotel and destination products", "inspiration followed by logistics, availability and reassurance", "not atmosphere before booking clarity", "keep dates, cancellation and accessibility visible at commitment", "apple-hig", "Travel design"),
    make_seed("music-language", "Music Product Language", "domain-language", "music, audio and culture products", "discovery, mood, sequence and playback continuity", "not album art tiles alone", "make queue, transport, lyrics and device state recoverable", "material-3", "Music UI language"),
    make_seed("gaming-language", "Gaming Product Language", "domain-language", "games and interactive entertainment", "state, reward, challenge, pause and world context", "not game-like decoration on a normal form", "separate critical settings from spectacle and support input diversity", "material-3", "Gaming UX language"),
    make_seed("education-language", "Education Product Language", "domain-language", "learning and training products", "progress, explanation, practice and feedback", "not childishness or gamification by default", "make misconception, retry and mastery visible without shame", "govuk", "Education UX language"),
    make_seed("developer-tools-language", "Developer Tools Language", "domain-language", "developer tools, infrastructure and code products", "traceability, commands, dense evidence and reversible change", "not monospace decoration", "prioritize copyable output, error context and keyboard flow", "primer", "Developer tool design"),
    make_seed("cybersecurity-language", "Cybersecurity Product Language", "domain-language", "security operations and risk products", "severity, evidence, uncertainty and controlled response", "not hacker imagery or red-on-black overload", "distinguish alert, hypothesis, action and verified state", "carbon", "Cybersecurity UX language"),
    make_seed("scientific-product-language", "Scientific Product Language", "domain-language", "scientific instruments and research software", "measurement, uncertainty, provenance and exploration", "not futuristic lab styling without units and method", "show data quality, calibration and export paths", "uswds", "Scientific interface"),
    make_seed("creative-tools-language", "Creative Tools Language", "domain-language", "design, video, audio and creative software", "direct manipulation, persistent context and reversible iteration", "not a gallery or dashboard", "define canvas, tools, shortcuts, history and export as one workflow", "primer", "Creative tool UI"),
    make_seed("museum-language", "Museum / Cultural Institution Language", "domain-language", "museums, galleries and cultural organizations", "context, interpretation, access and respectful discovery", "not an art gallery template", "give work, maker, date, provenance and alternative reading routes", "met-art-history", "Cultural interface"),
]


def reference(source_key: str, demonstrates: list[str]) -> dict:
    source = SOURCES[source_key]
    return {**source, "demonstrates": demonstrates, "status": "VERIFIED"}


def normalize_term(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "", folded)


def build_record(seed: dict, all_ids: list[str], category_ids: dict[str, list[str]]) -> dict:
    profile = PROFILES[seed["category"]]
    peers = [x for x in category_ids[seed["category"]] if x != seed["id"]]
    compatible = peers[:2]
    tension = [x for x in all_ids if x not in peers and x != seed["id"]][:2]
    source = SOURCES[seed["source"]]
    return {
        "id": seed["id"],
        "canonical_name": seed["canonical_name"],
        "aliases": seed["aliases"],
        "category": seed["category"],
        "era_origin": seed["era_origin"],
        "historical_context": f"{seed['era_origin']} established a recognizable visual language around {seed['focus']}. This record preserves the context while treating digital translation as a new product decision.",
        "core_principles": [seed["focus"], seed["control"], *profile["principles"][:1]],
        "visual_grammar": [seed["focus"], *profile["grammar"]],
        "typography": [*profile["type"], f"Use typography to distinguish {seed['focus']} from its nearest generic imitation."],
        "color_behavior": [*profile["color"], f"For this language, color should support {seed['focus']} rather than become the whole identity."],
        "spacing": [*profile["spacing"], "Test short, long and localized content before declaring the rhythm complete."],
        "geometry": [*profile["geometry"], f"Geometry should make the {seed['focus']} rule observable."],
        "layout": [*profile["layout"], "Preserve a primary reading and action route when the viewport changes."],
        "grid": ["Use a named alignment or field rule", "Do not let the reference replace product-specific content hierarchy", f"The grid must support {seed['focus']} without forcing every section into the same pattern."],
        "composition": [seed["focus"], seed["control"], "Give the focal point a clear counterweight or rest zone."],
        "hierarchy": ["product job → evidence → action", f"make the distinction from {seed['distinction']} visible in the hierarchy"],
        "density": "context-dependent; choose sparse, balanced or compact from task frequency and content volume",
        "surfaces": [*profile["surfaces"], f"Use surface treatment only where it reinforces {seed['focus']}."],
        "depth": ["flat by default", "depth earns its place through grouping, material or spatial evidence"],
        "borders": ["name whether edges frame, separate or signal state", "avoid decorative borders that compete with the governing language"],
        "imagery": ["choose documentary, product, illustrative or atmospheric imagery deliberately", f"imagery must strengthen {seed['focus']} and not obscure the task"],
        "iconography": ["use one coherent icon family", "prefer label plus icon when the action is unfamiliar"],
        "motion_character": [*profile["motion"], f"motion may express {seed['focus']} only after reduced-motion and pause behavior are defined"],
        "interaction_character": [*profile["interaction"], "focus, touch, keyboard and recovery are part of the language"],
        "responsive_behavior": ["recompose at narrow and mid widths", "preserve content priority rather than desktop coordinates", "test long labels and dense content"],
        "accessibility_considerations": ["do not use color, texture, motion or depth as the only state signal", "preserve heading, focus and reading order", "provide a reduced-motion/flat-surface route"],
        "content_fit": [seed["focus"], "content with a clear narrative or evidence relationship"],
        "product_fit": ["products where this visual argument improves trust, comprehension or identity", "the domains implied by the source and seed"],
        "good_use_cases": [f"a product that needs {seed['focus']}", "a campaign or surface where the language can be bounded by real content"],
        "bad_use_cases": [f"a product where {seed['distinction']}", "high-consequence dense workflows if the expressive layer harms scan speed"],
        "compatible_concepts": compatible,
        "tension_with": tension,
        "common_cliches": [f"treat {seed['canonical_name']} as a color palette", f"copy the surface while ignoring {seed['focus']}"],
        "failure_modes": [f"{seed['focus']} becomes decoration without product cause", "mobile or long content reveals that the visual rule was only composed for one screenshot", "contrast or interaction state disappears under the material treatment"],
        "anti_patterns": ["style-by-keyword", "every component competing for signature status", "unverified historical or platform claims"],
        "implementation_implications": [seed["control"], "encode the visual rule in tokens/components rather than one-off overrides", "render at compact, mid-width and wide states with realistic content"],
        "selection_rule": f"Select when the product can explain why {seed['focus']} improves the user's job; reject when it is only a trend label.",
        "distinguish_from": [seed["distinction"], "a generic polished component library with no causal visual thesis"],
        "modern_translation": f"Translate the source constraint of {seed['focus']} into current semantic HTML, responsive composition, accessible states and an honest media budget.",
        "control_rule": seed["control"],
        "reference_texts": [reference(seed["source"], [seed["focus"], "historical or system context"])],
        "visual_references": [reference(seed["source"], [seed["focus"], "composition and material signals", "what to preserve versus what to reject"])],
        "evidence": [{"claim": source["claim"], "state": "VERIFIED", "source": source["title"], "checked_at": source["checked_at"]}],
        "confidence": "HIGH" if seed["category"] in {"historical-foundational", "composition"} else "MEDIUM",
        "last_verified": source["checked_at"],
        "freshness": "LOW_VOLATILITY_HISTORICAL" if seed["category"] == "historical-foundational" else "MEDIUM_VOLATILITY_INTERPRETIVE",
        "tags": [seed["category"], seed["canonical_name"].lower(), seed["focus"]],
    }


def main() -> int:
    base_path = ROOT / "knowledge" / "design-concepts.json"
    base = json.loads(base_path.read_text(encoding="utf-8-sig"))
    base_names = {
        normalize_term(value)
        for concept in base["concepts"]
        for value in [concept["canonical_name"], *concept.get("aliases", [])]
    }
    base_alias_owners: dict[str, list[str]] = {}
    for concept in base["concepts"]:
        for value in concept.get("aliases", []):
            base_alias_owners.setdefault(normalize_term(value), []).append(concept["id"])

    # The baseline intentionally contains a few historically ambiguous aliases.
    # Expansion aliases must not make those collisions worse or create a second
    # owner; canonical names remain strict and are never silently deduplicated.
    accepted_seeds: list[dict] = []
    rejected_concepts: list[dict] = []
    for seed in SEEDS:
        canonical_key = normalize_term(seed["canonical_name"])
        if canonical_key in base_names:
            rejected_concepts.append({
                "concept_id": seed["id"],
                "canonical_name": seed["canonical_name"],
                "reason": "BASELINE_CANONICAL_OR_ALIAS_ALREADY_EXISTS",
            })
        else:
            accepted_seeds.append(seed)

    canonical_names = [normalize_term(seed["canonical_name"]) for seed in accepted_seeds]
    assert len(canonical_names) == len(set(canonical_names)), "duplicate expansion canonical name"
    expansion_aliases: set[str] = set()
    filtered_seeds: list[dict] = []
    rejected_aliases: list[dict] = []
    for seed in accepted_seeds:
        kept: list[str] = []
        for alias in seed["aliases"]:
            key = normalize_term(alias)
            if not key:
                rejected_aliases.append({"concept_id": seed["id"], "alias": alias, "reason": "EMPTY_NORMALIZED_TERM"})
            elif key in base_names:
                rejected_aliases.append({
                    "concept_id": seed["id"],
                    "alias": alias,
                    "reason": "BASELINE_TERM_ALREADY_OWNS_ALIAS_OR_NAME",
                    "existing_owner_ids": base_alias_owners.get(key, []),
                })
            elif key in expansion_aliases:
                rejected_aliases.append({"concept_id": seed["id"], "alias": alias, "reason": "EXPANSION_ALIAS_ALREADY_USED"})
            else:
                kept.append(alias)
                expansion_aliases.add(key)
        filtered_seeds.append({**seed, "aliases": kept})

    ids = [s["id"] for s in filtered_seeds]
    assert len(ids) == len(set(ids)), "duplicate expansion seed id"
    base_ids = {c["id"] for c in base["concepts"]}
    assert not base_ids.intersection(ids), f"expansion collides with baseline: {base_ids.intersection(ids)}"
    category_ids: dict[str, list[str]] = {}
    for seed in filtered_seeds:
        category_ids.setdefault(seed["category"], []).append(seed["id"])
    records = [build_record(seed, ids, category_ids) for seed in filtered_seeds]
    coverage_map = {category: sorted(values) for category, values in category_ids.items()}
    coverage = sorted({name for seed in filtered_seeds for name in [seed["canonical_name"], *seed["aliases"]]})
    output = {
        "corpus": "plief-sifr-design-expansion",
        "version": "1.0.0",
        "baseline_corpus": "knowledge/design-concepts.json",
        "last_verified": "2026-09-01",
        "coverage_semantics": "INDEX_OF_IMPLEMENTED_KNOWLEDGE",
        "coverage": coverage,
        "coverage_map": coverage_map,
        "deduplication": {
            "policy": "Expansion canonical names cannot duplicate the baseline; expansion aliases cannot shadow baseline terms or another expansion alias.",
            "rejected_concepts": rejected_concepts,
            "rejected_aliases": rejected_aliases,
        },
        "concepts": records,
        "source_registry": list(SOURCES.values()),
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {len(records)} Sifr expansion concepts to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
