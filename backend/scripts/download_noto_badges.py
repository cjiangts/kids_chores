#!/usr/bin/env python3
"""Download a broad, kid-friendly Noto emoji badge bank."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CURATED_DIR = PROJECT_ROOT / 'frontend' / 'assets' / 'badges-curated'
DEST_DIR = PROJECT_ROOT / 'frontend' / 'assets' / 'badges-noto'
RAW_BASE_URL = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128'

# Focus on clear, kid-recognizable objects, foods, animals, toys, vehicles, and rewards.
BADGE_SPECS = (
    ('airplane', '2708'),
    ('alarm-clock', '23f0'),
    ('american-football', '1f3c8'),
    ('ant', '1f41c'),
    ('artist-palette', '1f3a8'),
    ('baby-chick', '1f424'),
    ('backpack', '1f392'),
    ('badminton', '1f3f8'),
    ('balloon', '1f388'),
    ('banana', '1f34c'),
    ('baseball', '26be'),
    ('basketball', '1f3c0'),
    ('bat', '1f987'),
    ('bear-face', '1f43b'),
    ('beaver', '1f9ab'),
    ('bee', '1f41d'),
    ('bell', '1f514'),
    ('bicycle', '1f6b2'),
    ('bird', '1f426'),
    ('birthday-cake', '1f382'),
    ('blossom', '1f33c'),
    ('blowfish', '1f421'),
    ('blue-book', '1f4d8'),
    ('boar', '1f417'),
    ('bookmark', '1f516'),
    ('books', '1f4da'),
    ('bouquet', '1f490'),
    ('bow-and-arrow', '1f3f9'),
    ('bowling', '1f3b3'),
    ('bread', '1f35e'),
    ('bronze-medal', '1f949'),
    ('bug', '1f41b'),
    ('building-blocks', '1f9f1'),
    ('bus', '1f68c'),
    ('butterfly', '1f98b'),
    ('cactus', '1f335'),
    ('calendar', '1f4c5'),
    ('camera', '1f4f7'),
    ('candy', '1f36c'),
    ('canoe', '1f6f6'),
    ('carousel-horse', '1f3a0'),
    ('carrot', '1f955'),
    ('castle', '1f3f0'),
    ('cat-face', '1f431'),
    ('cherries', '1f352'),
    ('cherry-blossom', '1f338'),
    ('chocolate-bar', '1f36b'),
    ('clipboard', '1f4cb'),
    ('clover', '1f340'),
    ('cloud', '2601'),
    ('coin', '1fa99'),
    ('comet', '2604'),
    ('compass', '1f9ed'),
    ('confetti-ball', '1f38a'),
    ('cookie', '1f36a'),
    ('cow-face', '1f42e'),
    ('crab', '1f980'),
    ('crayon', '1f58d'),
    ('crescent-moon', '1f319'),
    ('crocodile', '1f40a'),
    ('croissant', '1f950'),
    ('crown', '1f451'),
    ('crystal-ball', '1f52e'),
    ('cupcake', '1f9c1'),
    ('deciduous-tree', '1f333'),
    ('diamond', '1f48e'),
    ('dog-face', '1f436'),
    ('dolphin', '1f42c'),
    ('doughnut', '1f369'),
    ('dragon', '1f409'),
    ('dragon-face', '1f432'),
    ('drum', '1f941'),
    ('duck', '1f986'),
    ('eagle', '1f985'),
    ('ear-of-corn', '1f33d'),
    ('eight-ball', '1f3b1'),
    ('evergreen-tree', '1f332'),
    ('fire', '1f525'),
    ('fire-engine', '1f692'),
    ('fish', '1f41f'),
    ('flashlight', '1f526'),
    ('flower-playing-cards', '1f3b4'),
    ('flying-saucer', '1f6f8'),
    ('fox', '1f98a'),
    ('frog', '1f438'),
    ('fountain-pen', '1f58b'),
    ('four-leaf-clover', '1f340'),
    ('framed-picture', '1f5bc'),
    ('french-fries', '1f35f'),
    ('game-die', '1f3b2'),
    ('gamepad', '1f3ae'),
    ('gem', '1f48e'),
    ('gift', '1f381'),
    ('glasses', '1f453'),
    ('globe', '1f30e'),
    ('glowing-star', '1f31f'),
    ('gold-medal', '1f947'),
    ('grapes', '1f347'),
    ('green-apple', '1f34f'),
    ('green-book', '1f4d7'),
    ('guitar', '1f3b8'),
    ('hamster-face', '1f439'),
    ('hatching-chick', '1f423'),
    ('headphone', '1f3a7'),
    ('hearts-gift', '1f49d'),
    ('helicopter', '1f681'),
    ('hibiscus', '1f33a'),
    ('honey-pot', '1f36f'),
    ('horse-face', '1f434'),
    ('hourglass', '231b'),
    ('house', '1f3e0'),
    ('ice-cream', '1f368'),
    ('joystick', '1f579'),
    ('key', '1f511'),
    ('keyboard', '1f3b9'),
    ('kite', '1fa81'),
    ('kiwi-fruit', '1f95d'),
    ('koala', '1f428'),
    ('lady-beetle', '1f41e'),
    ('leaf-fluttering-in-wind', '1f343'),
    ('ledger', '1f4d2'),
    ('lemon', '1f34b'),
    ('lion', '1f981'),
    ('lollipop', '1f36d'),
    ('lobster', '1f99e'),
    ('lock', '1f512'),
    ('locomotive', '1f682'),
    ('magic-wand', '1fa84'),
    ('magnifying-glass', '1f50d'),
    ('maple-leaf', '1f341'),
    ('memo', '1f4dd'),
    ('metro', '1f687'),
    ('microphone', '1f3a4'),
    ('milk-glass', '1f95b'),
    ('money-bag', '1f4b0'),
    ('monkey-face', '1f435'),
    ('mouse-face', '1f42d'),
    ('mushroom', '1f344'),
    ('notebook', '1f4d3'),
    ('notebook-with-cover', '1f4d4'),
    ('octopus', '1f419'),
    ('old-key', '1f5dd'),
    ('orange-book', '1f4d9'),
    ('owl', '1f989'),
    ('package', '1f4e6'),
    ('paintbrush', '1f58c'),
    ('panda', '1f43c'),
    ('paperclip', '1f4ce'),
    ('party-popper', '1f389'),
    ('peach', '1f351'),
    ('pear', '1f350'),
    ('penguin', '1f427'),
    ('pencil', '270f'),
    ('penguin-face', '1f427'),
    ('pie', '1f967'),
    ('pig-face', '1f437'),
    ('pineapple', '1f34d'),
    ('pizza', '1f355'),
    ('popcorn', '1f37f'),
    ('pretzel', '1f968'),
    ('puzzle-piece', '1f9e9'),
    ('rabbit-face', '1f430'),
    ('radio', '1f4fb'),
    ('rainbow', '1f308'),
    ('red-apple', '1f34e'),
    ('ribbon', '1f380'),
    ('ring', '1f48d'),
    ('rocket', '1f680'),
    ('roller-coaster', '1f3a2'),
    ('rose', '1f339'),
    ('sailboat', '26f5'),
    ('satellite', '1f6f0'),
    ('school', '1f3eb'),
    ('scroll', '1f4dc'),
    ('seal', '1f9ad'),
    ('seedling', '1f331'),
    ('shaved-ice', '1f367'),
    ('ship', '1f6a2'),
    ('shrimp', '1f990'),
    ('silver-medal', '1f948'),
    ('snail', '1f40c'),
    ('snake', '1f40d'),
    ('snowflake', '2744'),
    ('soccer-ball', '26bd'),
    ('sparkler', '1f387'),
    ('sparkles', '2728'),
    ('speedboat', '1f6a4'),
    ('sports-medal', '1f3c5'),
    ('star', '2b50'),
    ('strawberry', '1f353'),
    ('straight-ruler', '1f4cf'),
    ('sun', '2600'),
    ('sunflower', '1f33b'),
    ('taco', '1f32e'),
    ('tangerine', '1f34a'),
    ('taxi', '1f695'),
    ('teddy-bear', '1f9f8'),
    ('tennis', '1f3be'),
    ('tent', '26fa'),
    ('tiger-face', '1f42f'),
    ('tractor', '1f69c'),
    ('train', '1f686'),
    ('triangular-ruler', '1f4d0'),
    ('trophy', '1f3c6'),
    ('tropical-fish', '1f420'),
    ('trumpet', '1f3ba'),
    ('tulip', '1f337'),
    ('turtle', '1f422'),
    ('umbrella', '2602'),
    ('unicorn', '1f984'),
    ('unlocked', '1f513'),
    ('violin', '1f3bb'),
    ('volleyball', '1f3d0'),
    ('watch', '231a'),
    ('watermelon', '1f349'),
    ('whale', '1f433'),
    ('wolf', '1f43a'),
    ('yo-yo', '1fa80'),
)


def copy_existing_noto_assets():
    if not CURATED_DIR.is_dir():
        return 0
    copied = 0
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    for src_path in sorted(CURATED_DIR.glob('noto-*.png')):
        dest_path = DEST_DIR / src_path.name
        if dest_path.exists():
            continue
        shutil.copy2(src_path, dest_path)
        copied += 1
    return copied


def download_one(slug: str, codepoint_string: str, *, refresh: bool = False):
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    dest_path = DEST_DIR / f'noto-{slug}.png'
    if dest_path.exists() and not refresh:
        return 'skipped'

    url = f'{RAW_BASE_URL}/emoji_u{codepoint_string.lower()}.png'
    try:
        with urlopen(url, timeout=30) as response:
            data = response.read()
    except HTTPError as exc:
        return f'http-{exc.code}'
    except URLError:
        return 'network-error'

    dest_path.write_bytes(data)
    return 'downloaded'


def main():
    parser = argparse.ArgumentParser(description='Download a kid-friendly Noto badge bank.')
    parser.add_argument('--refresh', action='store_true', help='Re-download files even if they already exist.')
    args = parser.parse_args()

    copied = copy_existing_noto_assets()
    downloaded = 0
    skipped = 0
    failed = []
    seen_slugs = set()
    seen_codepoints = set()

    for slug, codepoint_string in BADGE_SPECS:
        normalized_codepoints = str(codepoint_string or '').strip().lower()
        if slug in seen_slugs or normalized_codepoints in seen_codepoints:
            continue
        seen_slugs.add(slug)
        seen_codepoints.add(normalized_codepoints)
        result = download_one(slug, normalized_codepoints, refresh=args.refresh)
        if result == 'downloaded':
            downloaded += 1
        elif result == 'skipped':
            skipped += 1
        else:
            failed.append((slug, result))

    total_files = len(list(DEST_DIR.glob('noto-*.png')))
    print(f'Copied existing Noto files: {copied}')
    print(f'Downloaded Noto files: {downloaded}')
    print(f'Skipped existing Noto files: {skipped}')
    print(f'Total Noto files in bank: {total_files}')
    if failed:
        print('Failed downloads:')
        for slug, reason in failed:
            print(f'  - {slug}: {reason}')


if __name__ == '__main__':
    main()
