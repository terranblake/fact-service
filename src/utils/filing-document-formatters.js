const moment = require('moment');

const { enums, logger, dateTypes, maths } = require('@postilion/utils');
const { Link }= require('@postilion/models');

const {
    magnitude,
    signum
} = maths;

const { supportedUnitTypes } = enums;

const {
    getDateType,
    getYearReported,
    getQuarterReported
} = dateTypes;

module.exports.formatFacts = async (elements, contexts, units, filing, company) => {
    let formattedFacts = [];

    for (let element in elements) {
        if (['xbrli:context', 'xbrli:unit', '$'].includes(element)) {
            logger.info(`skipping previously formatted element ${element} filing ${filing} company ${company}`);
            continue;
        }

        if (!element.includes(':')) {
            logger.debug(`unable to parse facts from element ${element} because it has no prefix`);
            continue;
        }

        for (let fact of elements[element]) {
            const formattedFact = await formatFact(fact, element, contexts, filing, company);
            formattedFacts.push(formattedFact);
        }
    }

    return formattedFacts;
}

async function formatFact(fact, element, contexts, filing, company) {
    const {
        decimals,
        contextRef,
        unitRef,
        label,
    } = fact.$;

    const factSignum = signum(decimals);
    const value = decimals
        && magnitude(fact._, decimals, factSignum)
        || fact._;

    let [prefix, name] = element.split(':');

    const context = contexts.find(c => c.label === (contextRef && contextRef.toLowerCase()));
    if (!context) {
        logger.debug(`missing context for fact identifier ${name} unitRef ${unitRef} filing ${filing}`);
    }

    const link = await Link.findOne({
        filing,
        company,
        name,
        type: 'locator',
        documentType: 'calculation',
    });

    if (link) {
        name = link.to.name;
    }

    return {
        filing,
        company,
        name,
        prefix,
        context: contextRef,
        date: context && context.date,
        value,
        unit: unitRef || 'n/a',
        // todo: fix unit calculation stuff after all facs are being pulled in correctly again
        // calculation: unit.calculation,
        // link: link && link._id,
        // itemType: unit.type,
        segment: context && context.segment,
        label,
        // todo :: Get balance for facts (debit, credit)
        // can be looked up from the elements tab of the taxonomy
        // balance: context.balance,
        sign: factSignum === '+',
        link: link && link._id,
    };
}

module.exports.formatUnits = (rawUnits) => {
    let formattedUnits = [];

    for (let rawUnit of rawUnits) {
        const id = rawUnit.$.id && rawUnit.$.id.toLowerCase();

        let type;
        let rawType = Object.keys(rawUnit).find(u => u.includes('xbrli:') || supportedUnitTypes.includes(u));
        const typeIncludesColon = rawType.includes(':');
        if (typeIncludesColon) {
            type = rawType.split(':').length
                ? rawType.split(':')[1]
                : 'measure';
        } else {
            type = rawType;
        }

        let unit = rawUnit[rawType];
        let formattedUnit = {
            id,
            // override this for simple measure unit types
            // when we split the unit identifier into prefix and name
            name: id,
            type,
            calculation: []
        };

        if (type === 'measure') {
            const [prefix, name] = unit[0].split(':');
            formattedUnit.calculation = [{ prefix, name }];
            formattedUnit.name = name && name.toLowerCase();
        } else {
            const measureKey = typeIncludesColon ? 'xbrli:measure' : 'measure';

            // only do this if the unit type isn't a simple measure calculation
            unit = unit[0];
            for (let item of Object.keys(unit)) {
                item = unit[item];

                // todo: handle numerator/denominator identification in calculation

                const [prefix, name] = item[0][measureKey][0].split(':');
                formattedUnit.calculation.push({ prefix, name });
            }
        }

        formattedUnits.push(formattedUnit);
    }

    return formattedUnits;
}

module.exports.formatContexts = async (extensionContexts, filing) => {
    let formattedContexts = [];
    for (let context of extensionContexts) {
        const entity = (context["xbrli:entity"] || context.entity)[0];
        const period = (context["xbrli:period"] || context.period)[0];

        // todo: confirm if there can be more than 1 segment defined for
        // a single context object. hard exit if so, to make it obvious
        // that something needs to be addressed
        const rawSegment = (entity["xbrli:segment"] || entity.segment);
        if (rawSegment && rawSegment.length > 1) {
            logger.error(`more than 1 segment found for filing ${filing && filing._id} bailing!`);
            continue;
        }

        let date = formatContextDate(period, filing);

        // todo: handle support for typed members
        if (rawSegment && rawSegment[0]['xbrldi:typedMember']) {
            logger.error(`skipping typed member beacuse it is not supported filing ${filing && filing._id} bailing!`);
        }

        const segment = rawSegment
            // todo: handle support for typed members
            && !rawSegment[0]['xbrldi:typedMember']
            && formatContextSegment(rawSegment[0]);

        formattedContexts.push({
            label: context.$.id && context.$.id.toLowerCase(),
            filing,
            segment,
            date,
        });
    }

    return formattedContexts;
}

function formatContextDate(contextPeriod, filing) {
    if (!contextPeriod) {
        throw new Error('context period is missing');
    }

    const rawDateType = Object.keys(contextPeriod)[0].includes('instant') ? 'instant' : 'series';
    const value = rawDateType === 'instant'
        ? new Date((contextPeriod["xbrli:instant"] || contextPeriod.instant)[0])
        : {
            startDate: new Date((contextPeriod["xbrli:startDate"] || contextPeriod.startDate)[0]),
            endDate: new Date((contextPeriod["xbrli:endDate"] || contextPeriod.endDate)[0])
        };

    const type = getDateType(value);

    return {
        type,
        value,
        quarter: getQuarterReported(value, type),
        year: getYearReported(value, type),
        fiscalYear: moment(filing.period).year()
    };
}

function formatContextSegment(segment = {}) {
    if (!segment['xbrldi:explicitMember']) {
        console.error(`missing explicitMember`);
        process.exit(1);
    }

    const members = segment['xbrldi:explicitMember'];
    if (!members.length) {
        return members;
    }

    let formattedSegment = [];
    for (let dimension of members) {
        const valueSplit = dimension._.split(':');
        const dimensionSplit = dimension.$.dimension.split(':');

        formattedSegment.push({
            value: {
                prefix: valueSplit[0],
                name: valueSplit[1]
            },
            dimension: {
                prefix: dimensionSplit[0],
                name: dimensionSplit[1]
            }
        })
    }

    return formattedSegment;
}

module.exports.formatLinkbaseArcs = (name, arcs) => {
    let formattedArcs = [];

    for (let arc of arcs) {
        arc = arc.$;
        const roleArc = arc['xlink:arcrole'].split('/').pop();
        const type = arc['xlink:type'];

        // link from this existing identifier in the tree
        const [, fromPrefix, fromName] = arc['xlink:from'].split('_');
        // link to an identifier that isn't normally in this tree
        const [, toPrefix, toName] = arc['xlink:to'].split('_');
        const { order, weight } = arc;

        formattedArcs.push({
            name: toName,
            role: {
                name,
                arc: roleArc
            },
            to: {
                prefix: toPrefix,
                name: toName
            },
            from: {
                prefix: fromPrefix,
                name: fromName
            },
            order,
            weight,
            type
        });
    }
    
    return formattedArcs;
}

module.exports.formatLinkbaseLocators = (name, locators) => {
    let formattedLocators = [];

    for (let locator of locators) {
        locator = locator.$;

        const type = locator['xlink:type'];
        const [fromPrefix, fromName] = locator['xlink:href'].split('#').pop().split('_');
        const [, toPrefix, toName,] = locator['xlink:label'].split('_');

        formattedLocators.push({
            name: fromName,
            role: {
                name,
                // todo: figure out if this is necessary for looking up items
                // arc: roleArc
            },
            to: {
                prefix: toPrefix,
                name: toName
            },
            from: {
                prefix: fromPrefix,
                name: fromName
            },
            // todo: lookup the corresponding toName identifier and spread that
            // identifier into this link
            // order,
            // weight,
            type
        })
    }

    return formattedLocators;
}