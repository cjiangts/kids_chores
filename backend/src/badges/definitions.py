from dataclasses import dataclass

# Badge catalog maintenance contract:
# - This file is append-only once rewards are live for real families.
# - Never change or reuse a shipped (achievement_key, category_key) pair.
# - Never rename an existing key to match a new title or idea; add a new key instead.
# - Safe live edits: new titles/threshold ladders as brand-new keys, and copy tweaks only
#   if you intentionally want old earned badges to display the new wording.
# - New definitions stay disabled until super-family assigns badge art for them.

THEME_KEYS = (
    'starter',
    'characters',
    'writing',
    'math',
    'reading',
    'gold',
    'streak',
    'effort',
    'all',
    'generic',
)


@dataclass(frozen=True)
class BadgeAchievementDefinition:
    achievement_key: str
    category_key: str
    title: str
    theme_key: str
    rule_type: str
    threshold_value: int
    reason_text: str
    goal_text: str


_CATEGORY_SPECS = (
    ('chinese_characters', 'Chinese Characters', 'characters'),
    ('chinese_writing', 'Chinese Writing', 'writing'),
    ('chinese_reading', 'Chinese Reading', 'reading'),
    ('math', 'Math', 'math'),
)

_CATEGORY_SESSION_TITLES = {
    'chinese_characters': {
        1: 'Character Spark',
        5: 'Hanzi Hopper',
        15: 'Symbol Scout',
        30: 'Scroll Climber',
        60: 'Character Ranger',
        120: 'Hanzi Hero',
        240: 'Character Legend',
    },
    'chinese_writing': {
        1: 'Brush Spark',
        5: 'Stroke Scout',
        15: 'Ink Hopper',
        30: 'Script Builder',
        60: 'Brush Ranger',
        120: 'Calligraphy Captain',
        240: 'Ink Legend',
    },
    'chinese_reading': {
        1: 'Story Spark',
        5: 'Page Scout',
        15: 'Chapter Chaser',
        30: 'Book Builder',
        60: 'Reading Ranger',
        120: 'Story Captain',
        240: 'Library Legend',
    },
    'math': {
        1: 'Number Spark',
        5: 'Pattern Scout',
        15: 'Puzzle Chaser',
        30: 'Problem Builder',
        60: 'Equation Explorer',
        120: 'Number Navigator',
        240: 'Math Legend',
    },
}

_CATEGORY_GOLD_TITLES = {
    'chinese_characters': {
        3: 'Golden Character',
        10: 'Golden Scroll',
        25: 'Golden Dragon',
    },
    'chinese_writing': {
        3: 'Golden Brush',
        10: 'Golden Ink',
        25: 'Golden Scroll',
    },
    'chinese_reading': {
        3: 'Golden Story',
        10: 'Golden Chapter',
        25: 'Golden Library',
    },
    'math': {
        3: 'Golden Numbers',
        10: 'Golden Puzzles',
        25: 'Golden Solver',
    },
}

_CATEGORY_SESSION_LEVELS = (
    ('first_session_in_category', 1, 'Starter'),
    ('sessions_5_in_category', 5, '5'),
    ('sessions_15_in_category', 15, '15'),
    ('sessions_30_in_category', 30, '30'),
    ('sessions_60_in_category', 60, '60'),
    ('sessions_120_in_category', 120, '120'),
    ('sessions_240_in_category', 240, '240'),
)

_CATEGORY_GOLD_LEVELS = (
    ('gold_3_in_category', 3, 'Gold 3'),
    ('gold_10_in_category', 10, 'Gold 10'),
    ('gold_25_in_category', 25, 'Gold 25'),
)

# Thresholds below were tuned from the local kid DB snapshot on March 11, 2026.
# Observed answered cards per completed session:
# - chinese_characters: ~61.7
# - math: ~36.2
# - chinese_writing: ~15.3
# - chinese_reading: ~4.1
_CATEGORY_CARD_THRESHOLDS = {
    'chinese_characters': (100, 300, 600, 1200, 2500),
    'chinese_writing': (25, 75, 150, 300, 600),
    'chinese_reading': (5, 20, 40, 80, 160),
    'math': (50, 150, 300, 600, 1200),
}

_CATEGORY_CARD_TITLES = {
    'chinese_characters': {
        100: 'Character Counter',
        300: 'Hanzi Stacker',
        600: 'Symbol Tower',
        1200: 'Character Mountain',
        2500: 'Hanzi Summit',
    },
    'chinese_writing': {
        25: 'Stroke Counter',
        75: 'Brush Stacker',
        150: 'Script Tower',
        300: 'Ink Mountain',
        600: 'Writing Summit',
    },
    'chinese_reading': {
        5: 'Page Counter',
        20: 'Story Stacker',
        40: 'Chapter Tower',
        80: 'Book Mountain',
        160: 'Library Summit',
    },
    'math': {
        50: 'Number Counter',
        150: 'Problem Stacker',
        300: 'Equation Tower',
        600: 'Math Mountain',
        1200: 'Number Summit',
    },
}

_READING_SPEED_2X_THRESHOLDS = (1, 3, 5, 10)
_READING_SPEED_2X_TITLES = {
    1: '2x Reading Boost',
    3: '2x Reading Sprint',
    5: '2x Reading Rocket',
    10: '2x Reading Legend',
}
_READING_SPEED_3X_THRESHOLDS = (1, 3, 5)
_READING_SPEED_3X_TITLES = {
    1: '3x Reading Boost',
    3: '3x Reading Rocket',
    5: '3x Reading Legend',
}

_TOTAL_SESSION_THRESHOLDS = (10, 25, 50, 100, 200, 350, 700)
_TOTAL_SESSION_TITLES = {
    10: 'Practice Spark',
    25: 'Practice Hopper',
    50: 'Practice Builder',
    100: 'Practice Rocket',
    200: 'Practice Ranger',
    350: 'Practice Captain',
    700: 'Practice Legend',
}
_ACTIVE_MINUTE_THRESHOLDS = (45, 120, 300, 700, 1500, 3000, 4500)
_ACTIVE_MINUTE_TITLES = {
    45: 'Quick Spark',
    120: 'Focus Flame',
    300: 'Steady Engine',
    700: 'Deep Dive',
    1500: 'Power Hourglass',
    3000: 'Time Voyager',
    4500: 'Time Titan',
}
_PRACTICE_DAY_THRESHOLDS = (7, 14, 30, 60, 120, 200, 300)
_PRACTICE_DAY_TITLES = {
    7: 'Show-Up Spark',
    14: 'Habit Hopper',
    30: 'Calendar Climber',
    60: 'Routine Ranger',
    120: 'Rhythm Rocket',
    200: 'Practice Pathfinder',
    300: 'Everyday Legend',
}
_ALL_ASSIGNED_DONE_LEVELS = (
    ('all_assigned_done_1_day', 1, 'Daily Champion'),
    ('all_assigned_done_15_days', 15, 'Checklist Crusher'),
    ('all_assigned_done_40_days', 40, 'Full-Plate Finisher'),
    ('all_assigned_done_80_days', 80, 'All-Set Ace'),
    ('all_assigned_done_150_days', 150, 'Mission Master'),
    ('all_assigned_done_250_days', 250, 'Whole-Board Hero'),
)
_STREAK_DAY_THRESHOLDS = (3, 7, 14, 30, 60)
_STREAK_TITLES = {
    3: 'Streak Spark',
    7: 'Week Warrior',
    14: 'Streak Climber',
    30: 'Streak Storm',
    60: 'Streak Legend',
}
_TOTAL_GOLD_SESSION_THRESHOLDS = (5, 15, 30, 60)
_TOTAL_GOLD_SESSION_TITLES = {
    5: 'Shiny Start',
    15: 'Golden Groove',
    30: 'Treasure Track',
    60: 'Crown Collector',
}
_RETRY_COMEBACK_THRESHOLDS = (3, 10, 25, 50)
_RETRY_COMEBACK_TITLES = {
    3: 'Bounce-Back Buddy',
    10: 'Second-Chance Star',
    25: 'Comeback Captain',
    50: 'Never-Give-Up Legend',
}

_CATEGORY_AVG_CARDS_PER_SESSION = {
    'chinese_characters': 61.7,
    'chinese_writing': 15.3,
    'chinese_reading': 4.125,
    'math': 36.2,
}
_CATEGORY_GOLD_RATE = {
    'chinese_characters': 10.0 / 53.0,
    'chinese_writing': 6.0 / 32.0,
    'chinese_reading': 15.0 / 16.0,
    'math': 10.0 / 16.0,
}
_AVG_ACTIVE_MINUTES_PER_SESSION = 5.2
_AVG_SESSIONS_PER_KID_DAY = 2.6
_OVERALL_GOLD_RATE = 0.3504
_OVERALL_COMEBACK_RATE = 0.1538
_READING_2X_CARD_RATE = 1.0 / 43.0
_READING_3X_CARD_RATE = 1.0 / 43.0
_CATEGORY_PRIORITY = {
    'chinese_characters': 0,
    'chinese_writing': 1,
    'chinese_reading': 2,
    'math': 3,
    '': 9,
}
_RULE_TYPE_PRIORITY = {
    'completed_sessions_in_category': 0,
    'cards_practiced_in_category': 1,
    'gold_sessions_in_category': 2,
    'reading_cards_2x_faster': 3,
    'reading_cards_3x_faster': 4,
    'total_completed_sessions': 5,
    'total_active_minutes': 6,
    'practice_days_total': 7,
    'total_gold_sessions': 8,
    'retry_comebacks': 9,
    'all_assigned_done_days': 10,
    'completion_streak_days': 11,
}


def _definition(
    *,
    achievement_key: str,
    category_key: str,
    title: str,
    theme_key: str,
    rule_type: str,
    threshold_value: int,
    reason_text: str,
    goal_text: str,
) -> BadgeAchievementDefinition:
    return BadgeAchievementDefinition(
        achievement_key=achievement_key,
        category_key=category_key,
        title=title,
        theme_key=theme_key,
        rule_type=rule_type,
        threshold_value=threshold_value,
        reason_text=reason_text,
        goal_text=goal_text,
    )


def _build_category_achievements():
    definitions = []
    for category_key, label, theme_key in _CATEGORY_SPECS:
        for achievement_key, threshold_value, title_suffix in _CATEGORY_SESSION_LEVELS:
            title = _CATEGORY_SESSION_TITLES[category_key][threshold_value]
            if threshold_value == 1:
                definitions.append(
                    _definition(
                        achievement_key=achievement_key,
                        category_key=category_key,
                        title=title,
                        theme_key=theme_key,
                        rule_type='completed_sessions_in_category',
                        threshold_value=threshold_value,
                        reason_text=f'Completed your first {label} practice session.',
                        goal_text=f'Complete your first {label} practice session.',
                    )
                )
                continue
            definitions.append(
                _definition(
                    achievement_key=achievement_key,
                    category_key=category_key,
                    title=title,
                    theme_key=theme_key,
                    rule_type='completed_sessions_in_category',
                    threshold_value=threshold_value,
                    reason_text=f'Completed {threshold_value} {label} practice sessions.',
                    goal_text=f'Complete {threshold_value} {label} practice sessions.',
                )
            )

        for achievement_key, threshold_value, title_suffix in _CATEGORY_GOLD_LEVELS:
            definitions.append(
                _definition(
                    achievement_key=achievement_key,
                    category_key=category_key,
                    title=_CATEGORY_GOLD_TITLES[category_key][threshold_value],
                    theme_key='gold',
                    rule_type='gold_sessions_in_category',
                    threshold_value=threshold_value,
                    reason_text=(
                        f'Finished {label} perfectly on the first try {threshold_value} times.'
                    ),
                    goal_text=(
                        f'Finish {label} perfectly on the first try {threshold_value} times.'
                    ),
                )
            )
    return tuple(definitions)


def _build_category_card_achievements():
    definitions = []
    for category_key, label, theme_key in _CATEGORY_SPECS:
        for threshold_value in _CATEGORY_CARD_THRESHOLDS[category_key]:
            definitions.append(
                _definition(
                    achievement_key=f'cards_{threshold_value}_in_category',
                    category_key=category_key,
                    title=_CATEGORY_CARD_TITLES[category_key][threshold_value],
                    theme_key=theme_key,
                    rule_type='cards_practiced_in_category',
                    threshold_value=threshold_value,
                    reason_text=f'Practiced {threshold_value} {label} cards.',
                    goal_text=f'Practice {threshold_value} {label} cards.',
                )
            )
    return tuple(definitions)


def _build_reading_improvement_achievements():
    definitions = []
    for threshold_value in _READING_SPEED_2X_THRESHOLDS:
        card_text = 'card' if threshold_value == 1 else 'cards'
        definitions.append(
            _definition(
                achievement_key=f'reading_2x_speed_{threshold_value}_cards',
                category_key='chinese_reading',
                title=_READING_SPEED_2X_TITLES[threshold_value],
                theme_key='reading',
                rule_type='reading_cards_2x_faster',
                threshold_value=threshold_value,
                reason_text=f'Read {threshold_value} {card_text} 2x faster than the first correct try.',
                goal_text=f'Read {threshold_value} {card_text} 2x faster than the first correct try.',
            )
        )
    for threshold_value in _READING_SPEED_3X_THRESHOLDS:
        card_text = 'card' if threshold_value == 1 else 'cards'
        definitions.append(
            _definition(
                achievement_key=f'reading_3x_speed_{threshold_value}_cards',
                category_key='chinese_reading',
                title=_READING_SPEED_3X_TITLES[threshold_value],
                theme_key='reading',
                rule_type='reading_cards_3x_faster',
                threshold_value=threshold_value,
                reason_text=f'Read {threshold_value} {card_text} 3x faster than the first correct try.',
                goal_text=f'Read {threshold_value} {card_text} 3x faster than the first correct try.',
            )
        )
    return tuple(definitions)


def _build_global_achievements():
    definitions = []

    for threshold_value in _TOTAL_SESSION_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'total_sessions_{threshold_value}',
                category_key='',
                title=_TOTAL_SESSION_TITLES[threshold_value],
                theme_key='generic',
                rule_type='total_completed_sessions',
                threshold_value=threshold_value,
                reason_text=f'Completed {threshold_value} total practice sessions.',
                goal_text=f'Complete {threshold_value} total practice sessions.',
            )
        )

    for threshold_value in _ACTIVE_MINUTE_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'active_minutes_{threshold_value}',
                category_key='',
                title=_ACTIVE_MINUTE_TITLES[threshold_value],
                theme_key='effort',
                rule_type='total_active_minutes',
                threshold_value=threshold_value,
                reason_text=f'Reached {threshold_value} total active minutes.',
                goal_text=f'Reach {threshold_value} total active minutes.',
            )
        )

    for threshold_value in _PRACTICE_DAY_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'practice_days_{threshold_value}',
                category_key='',
                title=_PRACTICE_DAY_TITLES[threshold_value],
                theme_key='generic',
                rule_type='practice_days_total',
                threshold_value=threshold_value,
                reason_text=f'Practiced on {threshold_value} different days.',
                goal_text=f'Practice on {threshold_value} different days.',
            )
        )

    for achievement_key, threshold_value, title in _ALL_ASSIGNED_DONE_LEVELS:
        if threshold_value == 1:
            reason_text = 'Finished all assigned subjects in one day.'
            goal_text = 'Finish all assigned subjects in one day.'
        else:
            reason_text = f'Finished all assigned subjects on {threshold_value} different days.'
            goal_text = f'Finish all assigned subjects on {threshold_value} different days.'
        definitions.append(
            _definition(
                achievement_key=achievement_key,
                category_key='',
                title=title,
                theme_key='all',
                rule_type='all_assigned_done_days',
                threshold_value=threshold_value,
                reason_text=reason_text,
                goal_text=goal_text,
            )
        )

    for threshold_value in _STREAK_DAY_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'streak_{threshold_value}_days',
                category_key='',
                title=_STREAK_TITLES[threshold_value],
                theme_key='streak',
                rule_type='completion_streak_days',
                threshold_value=threshold_value,
                reason_text=(
                    f'Finished all assigned work for {threshold_value} days in a row.'
                ),
                goal_text=(
                    f'Finish all assigned work for {threshold_value} days in a row.'
                ),
            )
        )

    for threshold_value in _TOTAL_GOLD_SESSION_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'gold_sessions_{threshold_value}',
                category_key='',
                title=_TOTAL_GOLD_SESSION_TITLES[threshold_value],
                theme_key='gold',
                rule_type='total_gold_sessions',
                threshold_value=threshold_value,
                reason_text=(
                    f'Finished {threshold_value} sessions perfectly on the first try.'
                ),
                goal_text=(
                    f'Finish {threshold_value} sessions perfectly on the first try.'
                ),
            )
        )

    for threshold_value in _RETRY_COMEBACK_THRESHOLDS:
        definitions.append(
            _definition(
                achievement_key=f'retry_comeback_{threshold_value}',
                category_key='',
                title=_RETRY_COMEBACK_TITLES[threshold_value],
                theme_key='generic',
                rule_type='retry_comebacks',
                threshold_value=threshold_value,
                reason_text=f'Recovered from retries {threshold_value} times.',
                goal_text=f'Recover from {threshold_value} retry sessions.',
            )
        )

    return tuple(definitions)


def _estimated_session_difficulty(definition: BadgeAchievementDefinition) -> float:
    rule_type = str(definition.rule_type or '').strip().lower()
    category_key = str(definition.category_key or '').strip().lower()
    threshold_value = float(definition.threshold_value or 0)
    if rule_type == 'completed_sessions_in_category':
        return threshold_value
    if rule_type == 'cards_practiced_in_category':
        return threshold_value / max(_CATEGORY_AVG_CARDS_PER_SESSION.get(category_key, 1.0), 1.0)
    if rule_type == 'gold_sessions_in_category':
        return threshold_value / max(_CATEGORY_GOLD_RATE.get(category_key, 0.05), 0.05)
    if rule_type == 'total_completed_sessions':
        return threshold_value
    if rule_type == 'total_active_minutes':
        return threshold_value / _AVG_ACTIVE_MINUTES_PER_SESSION
    if rule_type == 'practice_days_total':
        return threshold_value * _AVG_SESSIONS_PER_KID_DAY
    if rule_type == 'total_gold_sessions':
        return threshold_value / _OVERALL_GOLD_RATE
    if rule_type == 'retry_comebacks':
        return threshold_value / _OVERALL_COMEBACK_RATE
    if rule_type == 'all_assigned_done_days':
        return threshold_value * 5.0
    if rule_type == 'completion_streak_days':
        return threshold_value * 5.75
    if rule_type == 'reading_cards_2x_faster':
        return (
            threshold_value
            / _READING_2X_CARD_RATE
            / max(_CATEGORY_AVG_CARDS_PER_SESSION['chinese_reading'], 1.0)
        )
    if rule_type == 'reading_cards_3x_faster':
        return (
            threshold_value
            / _READING_3X_CARD_RATE
            / max(_CATEGORY_AVG_CARDS_PER_SESSION['chinese_reading'], 1.0)
            * 1.15
        )
    return threshold_value


def _definition_difficulty_sort_key(definition: BadgeAchievementDefinition):
    rule_type = str(definition.rule_type or '').strip().lower()
    category_key = str(definition.category_key or '').strip().lower()
    return (
        round(_estimated_session_difficulty(definition), 6),
        _RULE_TYPE_PRIORITY.get(rule_type, 99),
        _CATEGORY_PRIORITY.get(category_key, 99),
        int(definition.threshold_value or 0),
        str(definition.achievement_key or ''),
    )


DAY_ONE_BADGE_ACHIEVEMENTS = tuple(sorted(
    (
        _build_category_achievements()
        + _build_category_card_achievements()
        + _build_reading_improvement_achievements()
        + _build_global_achievements()
    ),
    key=_definition_difficulty_sort_key,
))


if len(DAY_ONE_BADGE_ACHIEVEMENTS) < 50:
    raise ValueError('Day-one badge catalog must contain at least 50 achievements.')


if len({(item.achievement_key, item.category_key) for item in DAY_ONE_BADGE_ACHIEVEMENTS}) != len(DAY_ONE_BADGE_ACHIEVEMENTS):
    raise ValueError('Achievement definitions must be unique by (achievement_key, category_key).')


for _definition in DAY_ONE_BADGE_ACHIEVEMENTS:
    if _definition.theme_key not in THEME_KEYS:
        raise ValueError(f'Unknown theme key: {_definition.theme_key}')
