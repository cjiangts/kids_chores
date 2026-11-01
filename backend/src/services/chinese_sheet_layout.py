"""Character assignment for Chinese sheet demo/practice groups."""
import math


def row_cards(row):
    return row.get('cards') or [row]


def row_capacity(columns, empty_count):
    return max(1, math.ceil((columns - 1) / (empty_count + 1)))


def column_cards(row, columns, empty_count):
    cards = row_cards(row)
    groups = row_capacity(columns, empty_count)
    base, remainder = divmod(groups, len(cards))
    assignments = [card for index, card in enumerate(cards)
                   for _ in range(base + (index < remainder))]
    return [assignments[min(column // (empty_count + 1), groups - 1)]
            for column in range(columns)]


def column_characters(row, columns, empty_count):
    """Resolve each practice box to its preceding demo, including word cards."""
    assigned = column_cards(row, columns, empty_count)
    occurrences = {}
    characters = []
    current = ''
    for column, card in enumerate(assigned):
        if column % (empty_count + 1) == 0 and column != columns - 1:
            text = list(str(card.get('front') or card.get('back') or ''))
            key = card['card_id']
            offset = occurrences.get(key, 0)
            current = text[offset % len(text)] if text else ''
            occurrences[key] = offset + 1
        characters.append(current)
    return characters
