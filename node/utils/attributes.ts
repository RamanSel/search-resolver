import { either, isEmpty, isNil, last } from 'ramda'
import unescape from 'unescape'

type FilterType = 'PRICERANGE' | 'TEXT'

interface Filter {
  type: FilterType
  name: string
  hidden: boolean
  values: FilterValue[]
}

interface FilterValue {
  quantity: number
  key: string
  id?: string
  href?: string
  name?: string
  value?: string
  selected?: boolean
  range?: {
    from: number
    to: number
  }
}

interface CatalogAttributeValues {
  FieldValueId: number
  Value: string
  Position: number
}

/**
 * Convert from Biggy's attributes into Specification Filters.
 *
 * @export
 * @param {Attribute[]} [attributes] Attributes from Biggy's API.
 * @returns {Filter[]}
 */
export const attributesToFilters = (
  {
    total,
    attributes,
  }: {
    total: number
    attributes?: ElasticAttribute[]
  },
  breadcrumb: Breadcrumb[]
): Filter[] => {
  if (either(isNil, isEmpty)(attributes)) {
    return []
  }

  const baseHref = (last(breadcrumb) ?? { href: '', name: '' }).href

  return attributes!.map((attribute) => {
    const { type, values } = convertValues(attribute, total, baseHref)

    return {
      values,
      type,
      name: attribute.label,
      hidden: !attribute.visible,
    }
  })
}

// NOTE: This should be removed when facet rework is done.
const knownPriceKeys = ['price', 'precio', 'preco', 'pret']

/**
 * Convert values, and create FilterType, that can be either `PRICERANGE` or
 * `TEXT`, only price uses the `PRICERANGE` type, other number attributes that
 * come from Biggy's API are transformed into TEXT filters.
 *
 * Location attributes are also transformed in TEXT filters, but when a location
 * is selected, only a single bucket is returned (the API returns multiple buckets,
 * but does not return the selected one, and there's no need to select multiple
 * location buckets).
 *
 * If an attribute is not of type `'text' | 'number' | 'location'`, an error will
 * be thrown.
 *
 * @param {Attribute} attribute
 * @returns {{ type: FilterType; values: FilterValue[] }}
 */
const convertValues = (
  attribute: ElasticAttribute,
  total: number,
  baseHref: string
): { type: FilterType; values: FilterValue[] } => {
  // When creating a filter for price attribute, it should be the only one to use
  // the type `'PRICERANGE'`.
  if (attribute.type === 'number' && knownPriceKeys.includes(attribute.key)) {
    return {
      type: 'PRICERANGE',
      values: attribute.values.map((value) => {
        return {
          quantity: value.count,
          key: attribute.key,
          name: attribute.label,
          value: attribute.key,
          selected: value.active,
          range: {
            from: Number.isNaN(parseFloat(value.from))
              ? attribute.minValue
              : parseFloat(value.from),
            to: Number.isNaN(parseFloat(value.to))
              ? attribute.maxValue
              : parseFloat(value.to),
          },
        }
      }),
    }
  }

  // For other `number` and `location` attributes we use TEXT based filters (checkboxes),
  // with buckets (e.g.: 0 - 30, 30 - 90, etc).
  if (attribute.type === 'number' || attribute.type === 'location') {
    const valuePrefix = attribute.type === 'location' ? 'l:' : ''

    // When a bucket is active, we should only show it, and none of the othter options.
    if (attribute.active) {
      return {
        type: 'TEXT',
        values: [
          {
            quantity: total,
            name: unescape(`${attribute.activeFrom} - ${attribute.activeTo}`),
            value: `${valuePrefix}${attribute.activeFrom}:${attribute.activeTo}`,
            key: attribute.key,
            selected: attribute.active,
          },
        ],
      }
    }

    return {
      type: 'TEXT',
      values: attribute.values.map((value) => {
        return {
          quantity: value.count,
          name: unescape(`${value.from} - ${value.to}`),
          key: attribute.key,
          value: `${valuePrefix}${value.from}:${value.to}`,
          selected: value.active,
        }
      }),
    }
  }

  // Basic `text` attributes.
  if (attribute.type === 'text') {
    return {
      type: 'TEXT',
      values: attribute.values.map((value) => {
        return {
          id: value.id,
          href: buildHref(baseHref, attribute.key, value.key),
          quantity: value.count,
          name: unescape(value.label),
          key: attribute.key,
          value: value.key,
          selected: value.active,
        }
      }),
    }
  }

  throw new Error(`Not recognized attribute type: ${attribute.type}`)
}

export const buildHref = (
  baseHref: string,
  key: string,
  value: string
): string => {
  if (isEmpty(key) || isEmpty(value)) {
    return baseHref
  }

  const [path = '', map = ''] = baseHref.split('?map=')
  const pathValues = [...path.split('/'), value].filter((x) => !isEmpty(x))
  const mapValues = [...map.split(','), key].filter((x) => !isEmpty(x))

  return `${pathValues.join('/')}?map=${mapValues.join(',')}`
}

export const sortAttributeValuesByCatalog = (
  attribute: ElasticTextAttribute,
  values: CatalogAttributeValues[]
) => {
  const findPositionByLabel = (label: string) => {
    const catalogValue = values.find((value) => value.Value === label)

    return catalogValue ? catalogValue.Position : -1
  }

  attribute.values.sort((a, b) => {
    const aPosition = findPositionByLabel(a.label)
    const bPosition = findPositionByLabel(b.label)

    return aPosition < bPosition ? -1 : 1
  })
}
