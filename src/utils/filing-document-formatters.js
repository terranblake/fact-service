const { Identifier, Link } = require('@postilion/models');
const { enums, logger, dateTypes, maths } = require('@postilion/utils');

const {
    magnitude,
    signum
} = maths;

const {
    factCurrencies,
    identifierPrefixes,
    supportedUnitTypes,
} = enums;

const {
    getDateType,
    getYearReported,
    getQuarterReported
} = dateTypes;

module.exports.formatFacts = async (unformattedFacts, contexts, units, filing, company) => {
    let expandedFacts = [];

    for (let fact in unformattedFacts) {
        // we only want facts we can process
        if (!identifierPrefixes.find(p => fact.includes(p))) {
            logger.error(`no valid prefix found for fact grouping ${fact}`);
            continue;
        }

        // get the gaap identifier name
        identifierName = fact.substr(fact.indexOf(':') + 1);
        const identifierExists = await Identifier.findOne({ name: identifierName });

        const link = await Link.findOne({ filing, company, name: identifierName });
        if (!identifierExists) {
            logger.error(`no identifier found for ${fact} searching links company ${company} filing ${filing}`);

            // fall back on link definitions if an identifier isn't found
            if (!link) {
                continue;
            }
        }

        const likeFacts = await expandAndFormatLikeFacts(unformattedFacts[fact], contexts, units, filing, company, identifierName, link);
        if (!likeFacts.length) {
            if (fact.includes('gaap')) {
                logger.info(`identifier with name ${identifierName} was a gaap identifier with no valid facts`);
            }
            continue;
        }

        for (let formatted of likeFacts) {
            expandedFacts.push(formatted);
        }
    }

    return expandedFacts;
}

async function expandAndFormatLikeFacts(facts, contexts, units, filing, company, identifierName, link) {
    let updatedFacts = [];

    for (let fact of facts) {
        const { unitRef, contextRef, value, signum } = await normalizeFact(fact);

        if (!unitRef) {
            logger.debug(`missing unitRef while formatting fact with context ${contextRef} value ${value}. skipping!`);
            continue;
        }

        const unit = await units.find(u => [u.name, u.type, u.id, ...factCurrencies].includes(unitRef));
        if (!unit) {
            logger.debug(`missing unit for fact identifier ${identifierName} unitRef ${unitRef} filing ${filing}`);
            continue;
        }

        const context = contexts.find(c => c.label === contextRef);
        if (!context) {
            logger.debug(`missing context for fact identifier ${identifierName} unitRef ${unitRef} filing ${filing}`);
            continue;
        }

        // use the identifier name as a reference to the correct
        // identifier being referenced for this fact
        // todo: validate that this works or use a cached version
        // of the gaap identifier tree to quickly lookup if the identifier
        // would be missing when building the tree and if replacing this
        // would actually improve the coverage of identifiers
        if (link && link.type === 'locator' && link.to.name !== identifierName) {
            identifierName = link.to.name;
        }

        fact = {
            filing,
            company,
            name: identifierName,
            date: context.date,
            itemType: unit.type,
            value,
            unit: unit.name || 'n/a',
            calculation: unit.calculation,
            link: link && link._id,
            segment: context.segment,
            label: fact.label || fact.name,
            // todo :: Get balance for facts (debit, credit)
            // balance: context.balance,
            sign: signum === '+',
        };

        if (!fact.filing) {
            logger.error(`missing fields for fact identifier ${identifierName} filing ${filing}`);
        }

        logger.info(`formatted fact unit ${unit && unit.name} identifier ${identifierName} context ${context && context.label} filing ${filing}`);
        updatedFacts.push(fact);
    };

    return updatedFacts;
}

function normalizeFact(fact) {
    const {
        decimals,
        contextRef,
        unitRef
    } = fact['$'];

    const factSignum = signum(decimals);
    value = decimals
        && magnitude(fact['_'], decimals, factSignum)
        || fact['_'];

    return {
        value,
        contextRef: contextRef && contextRef.toLowerCase(),
        unitRef: unitRef && unitRef.replace('iso4217_', '').toLowerCase(),
        decimals,
        signum: factSignum,
    }
}

module.exports.formatUnits = (rawUnits) => {
    logger.info('formatting units');

    let formattedUnits = []
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

    logger.info('formatted units');
    return formattedUnits;
}

module.exports.formatContexts = async (extensionContexts, filing, company) => {
    let formattedContexts = [];
    for (let context of extensionContexts) {
        const entity = (context["xbrli:entity"] || context.entity)[0];
        const period = (context["xbrli:period"] || context.period)[0];

        // todo: confirm if there can be more than 1 segment defined for
        // a single context object. hard exit if so, to make it obvious
        // that something needs to be addressed
        const rawSegment = (entity["xbrli:segment"] || entity.segment);
        if (rawSegment && rawSegment.length > 1) {
            logger.error(`more than 1 segment found for filing ${filing._id} company ${company._id}. bailing!`);
            process.exit(1);
        }

        const date = formatContextDate(period);

        // todo: handle support for typed members
        if (rawSegment && rawSegment[0]['xbrldi:typedMember']) {
            logger.error('skipping typed member beacuse it is not supported');
        }

        const segment = rawSegment
            // todo: handle support for typed members
            && !rawSegment[0]['xbrldi:typedMember']
            && formatContextSegment(rawSegment[0]);

        formattedContexts.push({
            label: context['$'].id && context['$'].id.toLowerCase(),
            filing,
            company,
            segment,
            date,
        });
    }

    return formattedContexts;
}

function formatContextDate(contextPeriod) {
    if (!contextPeriod) {
        throw new Error('context period is missing');
    }

    if (!Object.keys(contextPeriod)) {
        console.log({ contextPeriod });
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
        year: getYearReported(value, type)
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

module.exports.formatCalculationArcs = (name, arcs) => {
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

module.exports.formatCalculationLocators = (name, locators) => {
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