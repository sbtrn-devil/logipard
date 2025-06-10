//#LP-include lp-module-inc.lp-txt

//#LP M/stages/compile-stage/builtin-readers/lpgread-basic-json {
// <#./%title: logipard/lpgread-basic-json: Reader of FDOM from JSON file#>
// This reader is able to read FDOM from JSON file compiled by <#ref M/stages/compile-stage/builtin-writers/lpcwrite-basic-json#>.
// It is internally used by <#ref M/stages/generate-stage/builtin-writers/lpgwrite-example#>, but is also available for standalone
// use by your own generators (or for whatever other purposes). It follows the recommended model reader interface outline: <#ref M/lpgread-interface#>.
//
// See description of interface and usage: <#ref M/interfaces/lpgread-basic-json#>

//#LP } <-#lpgread-basic-json#>

//#LP M/interfaces/lpgread-basic-json { <#./%title: logipard/lpgread-basic-json.js#>
// This reader is able to read FDOM from JSON file compiled by <#ref M/stages/compile-stage/builtin-writers/lpcwrite-basic-json#>.
// It follows the recommended model reader interface outline: <#ref M/lpgread-interface#>.
//
// Usage example (assuming you have Logipard installed globally or as node module):
// ```
// const { loadFromFile } = require('logipard/lpgread-basic-json');
//
// async main() { // the loader API is async
//
// 	var reader = await loadFromFile("your-fdom.json");
//
// 	// assuming your model contains the items named as below...
// 	reader.nameAlias("domain.your.program", "M"); // set name alias
// 	var classesSection = reader.item("M/classes"); // <Item>, domain.your.program/classes
// 	var classA = reader.item(classesSection, "classA"); // <Item>, domain.your.program/classes/classA
//
// 	// let's find items for all classes extended by A and print their titles
// 	var extends = reader.item("%extends"); // %extends
// 	var queryCtxItemsExtByA = reader.newQueryContext(); // <QueryContext>
// 	var itemsExtByA = queryCtxItemsExtByA.with(classA) // or .with(queryCtxItemsExtByA.collection(classA))
// 		.query({ inMembersThat: { named: "^%extends$" }, recursive: true, query: { tagsThat: true }})
// 		.teardownCollection(); // itemsExtByA = <Collection>
//
// 	for (var itemExtByA of itemsExtByA) { // itemExtByA = <Item>
// 		console.log(reader.item(itemExtByA, "%title").content[0]); // assume all items have %title members with plain-text only content
// 	}
// }
// ```

var njsPath = require('path'),
	fs = require('fs'),
	BasicJsonFdom = require('./internal/basic-json-fdom-suppt.js'),
	lpUtil = require('./internal/lp-util.js'),
	util = require('util');

const sNode = Symbol(),
	sRootItem = Symbol(),
	sItemsByNode = Symbol(),
	sCheckCondition = Symbol(),
	sAsSet = Symbol();

//#LP ./Item { <#./%title: \<Item> [lpgread-basic-json]#> <#./%extends M/lpgread-interface/Item#> <#./%order: 2#>
// A FDOM item, as implemented in <#ref lpgread-basic-json#>.
function BasicJsonFdomItem(reader, node) {
	if (new.target) return BasicJsonFdomItem(reader, node);

	var me,
		cachedName,
		cachedMembers,
		cachedTags;

	if ((me = reader[sItemsByNode].get(node))) return me;

	function getCachedName() {
		if (cachedName) return cachedName;
		var arr = new Array();
		for (var theNode = node; theNode; theNode = theNode.parent) {
			if ('id' in theNode) arr.push(theNode.id);
		}
		arr.reverse();
		cachedName = arr.join("/");
		return cachedName;
	}

	return (me = {
		__proto__: BasicJsonFdomItem.prototype,
		// doc inherited from extents
		get name() {
			return getCachedName();
		},
		// doc inherited from extents
		get shortName() {
			return node.id;
		},
		//#LP ./uid %member { <#./%title %noloc: .uid#>
		// Read-only property, string. The item's shortcut UID in the JSON representation of the model.
		get uid() {
			return node.uid;
		},
		//#LP } <-#uid#>

		// doc inherited from extents
		get isNull() {
			return !!node.isNull;
		},

		// doc inherited from extents
		get parent() {
			var parentNode = node.parent;
			return parentNode ? BasicJsonFdomItem(reader, parentNode) : null;
		},

		// doc inherited from extents
		isConditionTrue(lpqCtx, condSpec) {
			return lpqCtx[sCheckCondition](me, condSpec);
		},
		//#LP ./toString %member { <#./%title %noloc: .toString()#>
		// JS stringification
		toString() {
			return "FdomItem<" + getCachedName() + (node.isNull ? " [NULL]": "") + ">";
		},
		//#LP } <-#toString#>
		[sNode]: node,

		// doc inherited from extents
		get members() {
			if (!cachedMembers) {
				cachedMembers = new BasicJsonFdomCollection();
				for (var memberNode of node.membersInOrder) {
					cachedMembers[sAsSet].add(BasicJsonFdomItem(reader, memberNode));
				}
			}
			return cachedMembers;
		},

		// doc inherited from extents
		get tags() {
			if (!cachedTags) {
				cachedTags = new BasicJsonFdomCollection();
				for (var tagNode of node.tags) {
					cachedTags[sAsSet].add(BasicJsonFdomItem(reader, memberNode));
				}
			}
			return cachedTags;
		},

		//#LP ./content %member { <#./%title %noloc: .content [lpgread-basic-json]#>
		// Read-only property, array of content elements. Implements <#ref M/lpgread-interface/Item/content#> in <#ref lpgread-basic-json#> specific flavour.
		//
		// Each element is either of:
		// - string: plain text piece of content, interpretation is up to the user and the particular context in user-level model.
		// - object `{ ref: <Item>, text: string }` (ref is <#ref lpgread-basic-json/Item#>): inline item ref
		// - object `{ customTag: object }`: a custom tag, originating from <#ref M/stages/compile-stage/builtin-writers/lpcwrite-basic-json#>
		get content() {
			return node.content;
		}
		//#LP } <-#content#>
	}, reader[sItemsByNode].set(node, me), me);
}

//#LP } Item

//#LP ./Collection { <#./%title: \<Collection> [lpgread-basic-json]#> <#./%extends M/lpgread-interface/Item#> <#./%order: 2#>
// A FDOM collection, as implemented in <#ref lpgread-basic-json#>.
function BasicJsonFdomCollection() {
	if (new.target) return BasicJsonFdomCollection();
	var me,
		mySet = new Set();

	return (me = {
		__proto__: BasicJsonFdomCollection.prototype,

		// doc inherited from extents
		[Symbol.iterator]() {
			return mySet[Symbol.iterator]();
		},

		get [sAsSet]() {
			return mySet;
		},

		// doc inherited from extents
		get size() {
			return mySet.size;
		},

		// doc inherited from extents
		contains(item) {
			return mySet.has(item);
		},

		//#LP ./toString %member { <#./%title %noloc: .toString()#>
		// JS stringification
		toString() {
			return "FdomCollection[" + [...mySet].toString() + "]";
		}
		//#LP } <-#toString#>
	});
}
//#LP } Collection

const sIsCondition = Symbol(),
	sIsQuery = Symbol(),
	sTempCollectionAlias = Symbol(),
	sTempCollectionAliases = Symbol(),
	sCurrentCollection = Symbol(),
	sDoQuery = Symbol(),
	sQueryAliases = Symbol(),
	sCondAliases = Symbol(),
	sQueryCache = Symbol();

function CollectionResolver(collSpec) {
	var me = this;
	this.get = function resolveCollection(lpqCtx) {
		var result = lpqCtx[sQueryCache].get(me);
		if (result == null) {
			result = lpqCtx.collection(collSpec);
			lpqCtx[sQueryCache].set(me, result);
		}
		return result;
	};
}

function ConditionFactory(reader) {
	function condition(func) {
		func[sIsCondition] = true;
		return func;
	}

	return {
		conditionAliased(condName) {
			return condition(function alias(lpqCtx, subjBJFI) {
				var cond = lpqCtx[sCondAliases][condName];
				if (!cond) throw new Error("Condition alias '" + condName + "' is not currently set in the context");
				return cond(lpqCtx, subjBJFI);
			});
		},

		conditionIsAnyOf(collSpec) {
			var collResolver = new CollectionResolver(collSpec);
			return condition(function isAnyOf(lpqCtx, subjBJFI) {
				for (var collItem of collResolver.get()) if (collItem == subjBJFI) return true;
				return false;
			});
		},

		conditionNamed(name) {
			var nameRegex = name instanceof RegExp ? name : new RegExp(name);
			return condition(function named(lpqCtx, subjBJFI) {
				return !!subjBJFI.shortName.match(nameRegex);
			});
		},

		conditionAnd(conds) {
			return condition(function and(lpqCtx, subjBJFI) {
				for (var cond of conds) if (!cond(lpqCtx, subjBJFI)) return false;
				return true;
			});
		},

		conditionOr(conds) {
			return condition(function or(lpqCtx, subjBJFI) {
				for (var cond of conds) if (cond(lpqCtx, subjBJFI)) return true;
				return false;
			});
		},

		conditionNot(cond) {
			return condition(function not(lpqCtx, subjBJFI) {
				return !cond(lpqCtx, subjBJFI);
			});
		},

		conditionBool(value) {
			value = !!value;
			return condition(function boolValue(lpqCtx, subjBJFI) {
				return value;
			});
		},

		conditionHasMembersNamed(name) {
			var nameRegex = name instanceof RegExp ? name : new RegExp(name);
			return condition(function hasMembersNamed(lpqCtx, subjBJFI) {
				for (var member of subjBJFI[sNode].membersInOrder) {
					if (member.shortName.match(nameRegex)) return true;
				}
				return false;
			});
		},

		conditionHasAnyOfTags(collSpec) {
			var collResolver = new CollectionResolver(collSpec);
			return condition(function hasAnyOfTags(lpqCtx, subjBJFI) {
				for (var member of collResolver.get(lpqCtx)) {
					if (subjBJFI[sNode].tags.has(member[sNode])) return true;
				}
				return false;
			});
		},

		conditionHasAllOfTags(collSpec) {
			var collResolver = new CollectionResolver(collSpec);
			return condition(function hasAllOfTags(lpqCtx, subjBJFI) {
				for (var member of collResolver.get(lpqCtx)) {
					if (!subjBJFI[sNode].tags.has(member[sNode])) return false;
				}
				return true;
			});
		},

		conditionHasParentThat(condSpec) {
			var cond = compileCondition(reader, condSpec);
			return condition(function hasParentThat(lpqCtx, subjBJFI) {
				var parent = subjBJFI.parent;
				return !!parent && cond(lpqCtx, parent);
			});
		},

		conditionHasMembersThat(name) {
			var cond = compileCondition(reader, condSpec);
			return condition(function hasMembersThat(lpqCtx, subjBJFI) {
				for (var member of subjBJFI.members) {
					if (cond(lpqCtx, member)) return true;
				}
				return false;
			});
		}
	};
}

function compileCondition(reader, condSpec) {
	var condFactory = ConditionFactory(reader);

	if (condSpec != null && typeof(condSpec) == 'object') {
		if (condSpec[sIsCondition]) {
			return condSpec; // an already compiled condition
		}

		if ('and' in condSpec) {
			var conds = Array.isArray(condSpec.and)? [...condSpec.and] : [condSpec.and];
			for (var i = 0; i < conds.length; i++) {
				conds[i] = compileCondition(reader, conds[i]);
			}
			return condFactory.conditionAnd(conds);
		}
		if ('or' in condSpec) {
			var conds = Array.isArray(condSpec.or)? [...condSpec.or] : [condSpec.or];
			for (var i = 0; i < conds.length; i++) {
				conds[i] = compileCondition(reader, conds[i]);
			}
			return condFactory.conditionOr(conds);
		}
		if ('not' in condSpec) {
			return condFactory.conditionNot(compileCondition(reader, condSpec.not));
		}
		if ('isAnyOf' in condSpec) {
			return condFactory.conditionIsAnyOf(condSpec.isAnyOf);
		}
		if ('named' in condSpec) {
			return condFactory.conditionNamed(condSpec.named);
		}
		if ('hasMembersNamed' in condSpec) {
			return condFactory.conditionHasMembersNamed(condSpec.hasMembersNamed);
		}
		if ('hasAllOfMembers' in condSpec) {
			return condFactory.conditionHasAllOfMembers(condSpec.hasAllOfMembers);
		}
		if ('hasAnyOfTags' in condSpec) {
			return condFactory.conditionHasAnyOfTags(condSpec.hasAnyOfTags);
		}
		if ('hasAllOfTags' in condSpec) {
			return condFactory.conditionHasAllOfTags(condSpec.hasAllOfTags);
		}
		if ('hasParentThat' in condSpec) {
			return condFactory.conditionHasParentThat(condSpec.hasParentThat);
		}
		if ('hasMembersThat' in condSpec) {
			return condFactory.conditionHasMembersThat(condSpec.hasMembersThat);
		}
	}

	// a string is a condition alias
	if (typeof(condSpec) == 'string') {
		return condFactory.conditionAliased(condSpec);
	}
	if (typeof(condSpec) == 'boolean') {
		return condFactory.conditionBool(condSpec);
	}
	throw new Error("Invalid condition " + util.inspect(condSpec));
}

function compileThatItem(reader, queryThatItem) {
	// note: relying on forward-declared compileQuery

	function query(func) {
		func[sIsQuery] = true;
		return func;
	}

	// return: collection
	function performSubQueryOnCollection(lpqCtx, coll, subQuery) {
		var prevColl = lpqCtx[sCurrentCollection];
		lpqCtx[sCurrentCollection] = coll;
		subQuery[sDoQuery](lpqCtx);
		var resultColl = lpqCtx[sCurrentCollection];
		lpqCtx[sCurrentCollection] = prevColl;
		return resultColl;
	}

	// helper for making { in...: ... } versions of a query (based on non-'in' version as a sub-query)
	function makeInQuery(queryItem, preQuery) {
		var recursive = !!queryItem.recursive,
			// pre-query must be forced non-recursive (we will take over the recursion)
			preQuery = compileQuery(reader, Object.assign(new Object(), preQuery, { recursive: false })),
			postQuery = compileQuery(reader, queryItem.query);
		return query(function applyInThatQuery(lpqCtx, srcColl, targetSet) {
			var itemsSearched = new Set();

			function enumerateCollection(coll) {
				var preColl = performSubQueryOnCollection(lpqCtx, coll, preQuery),
					postColl = performSubQueryOnCollection(lpqCtx, preColl, postQuery),
					newItems = new BasicJsonFdomCollection(),
					newItemsSet = newItems[sAsSet];

				for (var item of postColl) {
					if (itemsSearched.has(item) || item.isNull) continue;
					itemsSearched.add(item);
					targetSet.add(item);
					if (recursive) newItemsSet.add(item);
				}

				if (recursive && newItems.size > 0) {
					enumerateCollection(newItems);
				}
			}

			enumerateCollection(srcColl);
		});
	}

	// itemsThat
	if (queryThatItem.itemsThat) {
		let cond = compileCondition(reader, queryThatItem.itemsThat);
		// note that recursive is not applicable to itemsThat query (but not to inItemsThat)
		return query(function applyItemsThat(lpqCtx, srcColl, targetSet) {
			var itemsSearched = new Set();
			function enumerateNodeItems(nodeItems) {
				var item;
				for (var nodeItem of nodeItems) {
					if (itemsSearched.has(nodeItem) || nodeItem.isNull) continue;
					itemsSearched.add(nodeItem);
					if (cond(lpqCtx, item = BasicJsonFdomItem(reader, nodeItem))) {
						targetSet.add(item);
					}
				}
			}

			var collNodes = new Array();
			for (var item of srcColl) {
				collNodes.push(item[sNode]);
			}
			enumerateNodeItems(collNodes);
		});
	}

	// inItemsThat
	if (queryThatItem.inItemsThat) {
		return query(makeInQuery(queryThatItem, { itemsThat: queryThatItem.inItemsThat }));
	}

	// membersThat
	if (queryThatItem.membersThat) {
		let cond = compileCondition(reader, queryThatItem.membersThat),
			recursive = !!queryThatItem.recursive;
		return query(function applyMembersThat(lpqCtx, srcColl, targetSet) {
			var itemsSearched = new Set();
			function enumerateNodeItems(nodeItems) {
				var item;
				for (var nodeItem of nodeItems) {
					if (itemsSearched.has(nodeItem) || nodeItem.isNull) continue;
					itemsSearched.add(nodeItem);
					if (cond(lpqCtx, item = BasicJsonFdomItem(reader, nodeItem))) {
						targetSet.add(item);
						if (recursive) {
							enumerateNodeItems(nodeItem.membersInOrder);
						}
					}
				}
			}

			for (var item of srcColl) {
				enumerateNodeItems(item[sNode].membersInOrder);
			}
		});
	}

	// inMembersThat
	if (queryThatItem.inMembersThat) {
		return query(makeInQuery(queryThatItem, { membersThat: queryThatItem.inMembersThat }));
	}

	// tagsThat
	if (queryThatItem.tagsThat) {
		let cond = compileCondition(reader, queryThatItem.tagsThat),
			recursive = !!queryThatItem.recursive;
		return query(function applyTagsThat(lpqCtx, srcColl, targetSet) {
			var itemsSearched = new Set();
			function enumerateNodeItems(nodeItems) {
				var item;
				for (var nodeItem of nodeItems) {
					if (itemsSearched.has(nodeItem) || nodeItem.isNull) continue;
					itemsSearched.add(nodeItem);
					if (cond(lpqCtx, item = BasicJsonFdomItem(reader, nodeItem))) {
						targetSet.add(item);
						if (recursive) {
							enumerateNodeItems(nodeItem[sNode].tags);
						}
					}
				}
			}

			for (var item of srcColl) {
				enumerateNodeItems(item[sNode].tags);
			}
		});
	}

	// inTagsThat
	if (queryThatItem.inTagsThat) {
		return query(makeInQuery(queryThatItem, { tagsThat: queryThatItem.inTagsThat }));
	}
}

//#LP ./Query { <#./%title: \<Query> [lpgread-basic-json]#> <#./%extends M/lpgread-interface/Query#> <#./%order: 2#>
// A FDOM compiled query object, as implemented in <#ref lpgread-basic-json#>.

//#LP } <-#Query#>

function BasicJsonFdomQueryItem() {
	// placeholder for prototype, not used directly
}

function compileQuery(reader, queryItem) {
    function makeQuery(f, isCurrentCollectionChanger = false) {
    	return {
    		__proto__: BasicJsonFdomQueryItem.prototype,
    		[sDoQuery]: f
    	};
    }

    if (typeof (queryItem) == 'string') {
		// named precompiled query
		return makeQuery(function doqList(lpqCtx) {
			query = lpqCtx[sQueryAliases][queryItem];
			if (!query) throw new Error("Query alias '" + queryItem + "' is not currently set in the context");
			query[sDoQuery](lpqCtx);
		});
	}

	if (queryItem instanceof BasicJsonFdomQueryItem) {
		return queryItem; // already a query, nothing to do
	}

	// non-string, non-true query item is clearly invalid
	if (!queryItem) throw new Error("Invalid query item specification");

    // nested query array (executes as if unwrapped flat)
	if (Array.isArray(queryItem)) {
		if (queryItem.length == 1) compileQuery(reader, queryItem[0]); // single-element optimization
		var subItems = new Array(), isCCChanger = false;
		for (var subItem of queryItem) {
			subItem = compileQuery(reader, subItem);
			subItems.push(compileQuery(reader, subItem));
		}
		return makeQuery(function doqList(lpqCtx) {
			for (var subItem of subItems) subItem[sDoQuery](lpqCtx);
		});
	}

	// { alias: collName }
	// remember the current query subject under a (temporary) collection alias
	// temp aliases are in effect until lpqCtx.teardownCollection(...)
	if (queryItem && queryItem.alias) {
		return makeQuery(function doqSetTempCollAlias(lpqCtx) {
			if (!lpqCtx[sCurrentCollection]) throw new Error("No collection is currently a query subject");
			lpqCtx[sTempCollectionAlias](queryItem.alias, lpqCtx[sCurrentCollection]);
		});
	}

	// { with: collSpec }
	// set the given collection as current query subject
	if (queryItem.with) {
		return makeQuery(function doqSetCurrentCollection(lpqCtx) {
			var coll = lpqCtx.collection(queryItem.with);
			lpqCtx.with(lpqCtx.collection(queryItem.with));
		});
	}

	// { membersThat: condSpec, [recursive: true], [on: collSpec] }
	// { itemsThat: condSpec, [on: collSpec] }
	// { tagsThat: condSpec, [recursive: true], [on: collSpec] }
	// { inMembersThat: condSpec, query: [...queryItems], [recursive: true], [on: collSpec] }
	// { inItemsThat: condSpec, query: [...queryItems], [recursive: true], [on: collSpec] }
	// { inTagsThat: condSpec, query: [...queryItems], [recursive: true], [on: collSpec] }
	if (queryItem.membersThat || queryItem.itemsThat || queryItem.tagsThat ||
		queryItem.inMembersThat || queryItem.inItemsThat || queryItem.inTagsThat) {
		var thatItem = compileThatItem(reader, queryItem);
		var collResolver = ('on' in queryItem)? new CollectionResolver(queryItem.on) : null;
		return makeQuery(function doqThat(lpqCtx) {
			var result = new BasicJsonFdomCollection();
			thatItem(lpqCtx, collResolver ? collResolver.get(lpqCtx) : lpqCtx[sCurrentCollection], result[sAsSet]);
			lpqCtx[sCurrentCollection] = result;
		});
	}

	// { subtractQuery: [...queryItems], [on: collSpec] }
	if (queryItem.subtractQuery) {
		var collResolver = ('on' in queryItem) ? new CollectionResolver(queryItem.on) : null,
			subQuery = compileQuery(reader, queryItem.subtractQuery);
		return makeQuery(function doqSubtractQuery(lpqCtx) {
			var coll = collResolver ? collResolver.get(lpqCtx) : lpqCtx[sCurrentCollection];
			lpqCtx[sCurrentCollection] = coll;
			subQuery[sDoQuery](lpqCtx);
			lpqCtx[sCurrentCollection] = lpqCtx.collection({ subtract: [ coll, lpqCtx[sCurrentCollection]]});
		});
	}

	// { unionQuery: [...queryItems], [on: collSpec] }
	if (queryItem.unionQuery) {
		var collResolver = ('on' in queryItem) ? new CollectionResolver(queryItem.on) : null,
			subQuery = compileQuery(reader, queryItem.unionQuery);
		return makeQuery(function doqUnionQuery(lpqCtx) {
			var coll = collResolver ? collResolver.get(lpqCtx) : lpqCtx[sCurrentCollection];
			lpqCtx[sCurrentCollection] = coll;
			subQuery[sDoQuery](lpqCtx);
			lpqCtx[sCurrentCollection] = lpqCtx.collection({ union: [ coll, lpqCtx[sCurrentCollection]]});
		});
	}

	// { intersectQuery: [...queryItems], [on: collSpec] }
	if (queryItem.intersectQuery) {
		var collResolver = ('on' in queryItem) ? new CollectionResolver(queryItem.on) : null,
			subQuery = compileQuery(reader, queryItem.intersectQuery);
		return makeQuery(function doqIntersectQuery(lpqCtx) {
			var coll = collResolver ? collResolver.get(lpqCtx) : lpqCtx[sCurrentCollection];
			lpqCtx[sCurrentCollection] = coll;
			subQuery[sDoQuery](lpqCtx);
			lpqCtx[sCurrentCollection] = lpqCtx.collection({ intersect: [ coll, lpqCtx[sCurrentCollection]]});
		});
	}

	// { sideQuery: [...queryItems], [on: collSpec] }
	if (queryItem.sideQuery) {
		var collResolver = ('on' in queryItem) ? new CollectionResolver(queryItem.on) : null,
			subQuery = compileQuery(reader, queryItem.sideQuery);
		return makeQuery(function doqSideQuery(lpqCtx) {
			var oldColl = lpqCtx[sCurrentCollection], coll = collResolver ? collResolver.get(lpqCtx) : oldColl;
			lpqCtx[sCurrentCollection] = coll;
			subQuery[sDoQuery](lpqCtx);
			lpqCtx[sCurrentCollection] = oldColl;
		});
	}

	throw new Error("Invalid query item specification " + util.inspect(queryItem));
}

//#LP ./Context { <#./%title: \<Context> [lpgread-basic-json]#> <#./%extends M/lpgread-interface/Context#> <#./%order: 3#>
// A FDOM query context, as implemented in <#ref lpgread-basic-json#>.
function BasicJsonFdomContext(reader) {
	if (new.target) return BasicJsonFdomContext(reader);

	var me,
		nameAliases = new Object(), // ID => name prefix, as array
		queryAliases = new Object(), // ID => BasicJsonFdomQueryItem
		permCollAliases = new Object(), // ID => BasicJsonFdomCollection
		tempCollAliases = new Object(), // same
		condAliases = new Object(), // ID => condition
		currentCollection = null,
		queryCache = new Map();

	function resolveNameAlias(nameArray) {
		var result;
		if (nameArray[0] && (result = nameAliases[nameArray[0]])) {
			return result.concat(nameArray.slice(1));
		}
		return nameArray;
	}

	return (me = {
		// given an item, as BasicJsonFdomItem or name, probably starting with NS alias,
		// and optionally path to sub(-sub-...)member, return the corresponding item's BasicJsonFdomItem object
		item(item, name) {
			if (typeof (item) !== 'string' && !(item instanceof BasicJsonFdomItem)) {
				throw new Error('Item must be a name string or an lpgread-basic-json item object');
			}

			if (typeof (item) === 'string') {
				item = lpUtil.parseName(item);
			}

			if (Array.isArray(item)) {
				item = resolveNameAlias(item);
			} else {
				throw new Error('Item name must be a string or strings array');
			}

			if (!name) {
				name = [];
			} else if (typeof (name) === 'string') {
				name = lpUtil.parseName(name);
			} else {
				throw new Error('Item rel name must be a string');
			}

			// by this point, item can be either string array or BasicJsonFdomItem, name is always a string array
			return reader.item(item, name);
		},

		//#LP Context/itemByUid %member %method { <#./%title %noloc: .itemByUid(uid)#>
		// Return an item by UID (see <#ref lpgread-basic-json/Item/uid#>). Since this is a reader-specific method not prescribed by FDOM comprehension,
		// it can return `null` for non-existent item.
		//#LP ./uid %arg: String. The item UID, as returned by its `.uid` property.
		//#LP ./%return: <#ref lpgread-basic-json/Item#>, or `null`.
		//#LP } <-#itemByUid#>
		itemByUid(uid) {
			return reader.itemByUid(uid);
		},

		// documentation inherited as for item from extents
		nameAlias(alias, aliasPath) {
			if (aliasPath instanceof BasicJsonFdomItem) {
				aliasPath = lpUtil.parseName(aliasPath.name);
			} else {
				if (typeof (aliasPath) === 'string') {
					aliasPath = lpUtil.parseName(aliasPath);
				}

				if (!Array.isArray(aliasPath)) {
					throw new Error("aliasPath must be a name string, strings array, or a BasicJsonFdomItem");
				}
				aliasPath = resolveNameAlias(aliasPath);
			}
			nameAliases[alias] = aliasPath;
			return me;
		},

		// documentation inherited as for item from extents
		teardownCollection() {
			if (!currentCollection) {
				throw new Error("No collection is currently a query subject");
			}
			templCollAliases = new Object();
			var result = currentCollection;
			currentCollection = null;
			return result;
		},

		// documentation inherited as for item from extents
		collection(...collectionSpec) {
			if (collectionSpec.length == 1) {
				// some shortcut optimizations
				if (collectionSpec[0] instanceof BasicJsonFdomCollection) return collectionSpec[0];
				if (typeof (collectionSpec[0]) === 'string') {
					var collAlias = tempCollAliases[collectionSpec[0]] || permCollAliases[collectionSpec[0]];
					if (collAlias) {
						return collAlias;
					}
				}
			}

			// a more generic coll spec - try the harder way
			var coll = new BasicJsonFdomCollection(),
				set = coll[sAsSet];
			function fillCollection(collSpec) {
				// an array or (sub-)collection
				if (Array.isArray(collSpec) || (collSpec instanceof BasicJsonFdomCollection)) {
					for (var subCollSpec of collSpec) {
						fillCollection(subCollSpec);
					}
					return;
				}

				if (collSpec instanceof BasicJsonFdomItem) {
					// a single item
					if (!collSpec[sNode].isNull) {
						set.add(collSpec);
					}
					return;
				}

				if (typeof (collSpec) === 'string') {
					// a name
					var collAlias = tempCollAliases[collSpec] || permCollAliases[collSpec];
					if (collAlias) {
						// it is a collection alias
						for (var item of collAlias) {
							if (!item[sNode].isNull) {
								set.add(item);
							}
						}
						return;
					}

					// otherwise assume it is an item name
					var item = me.item(collSpec);
					if (!item[sNode].isNull) {
						set.add(item);
					}
					return;
				}

				if (collSpec.union) {
					for (var subColl of collSpec.union) {
						subColl = me.collection(subColl);
						for (var subItem of subColl) {
							set.add(subItem);
						}
					}
					return;
				}

				if (collSpec.intersect) {
					var resColl = null;
					for (var subColl of collSpec.intersect) {
						subColl = me.collection(subColl);
						if (!resColl) resColl = new Set([...subColl]);
						else {
							var newSubColl = new Set();
							for (var resItem of (resColl.size < subColl.size ? resColl : subColl)) {
								if (subColl.has(resItem) && resColl.has(resItem)) newSubColl.add(resItem);
							}
							subColl = newSubColl;
						}
					}
					if (resColl) {
						for (var resItem of resColl) set.add(resItem);
					}
					return;
				}

				if (collSpec.subtract) {
					var resColl = null;
					for (var subColl of collSpec.subtract) {
						subColl = me.collection(subColl);
						if (!resColl) resColl = new Set([...subColl]);
						else {
							for (var subItem of subColl) {
								resColl.delete(subItem);
							}
						}
					}
					if (resColl) {
						for (var resItem of resColl) set.add(resItem);
					}
					return;
				}

				throw new Error("Invalid collection spec item " + util.inspect(collSpec));
			}
			fillCollection(collectionSpec);
			return coll;
		},

		// documentation inherited as for item from extents
		with(...collectionSpec) {
			currentCollection = me.collection(...collectionSpec);
			return me;
		},

		// documentation inherited as for item from extents
		query(...querySpecs) {
			if (!currentCollection) throw new Error("No collection is currently a query subject");
			queryCache = new Map(); // clear query cache
			tempCollAliases = new Object(); // and pre-cleanup temp coll aliases
			try {
				compileQuery(reader, querySpecs)[sDoQuery](me);
			} finally {
				tempCollAliases = new Object(); // cleanup temp coll aliases
			}
			return me;
		},

		// documentation inherited as for item from extents
		compileQuery(...querySpecs) {
			return compileQuery(reader, querySpecs);
		},

		// documentation inherited as for item from extents
		collectionAlias(alias, ...collSpecs) {
			permCollAliases[alias] = me.collection(...collSpecs);
			return me;
		},

		// documentation inherited as for item from extents
		conditionAlias(alias, condSpec) {
			condAliases[alias] = compileCondition(reader, condSpec);
			return me;
		},

		// documentation inherited as for item from extents
		queryAlias(alias, ...querySpecs) {
			queryAliases[alias] = compileQuery(reader, querySpecs);
			return me;
		},

		//#LP Context/clearNameAlias %member %method { <#./%title %noloc: .clearNameAlias(aliasName)#>
		// Clear item name alias set by <#ref M/lpgread-interface/Context/nameAlias#>. The alias is no longer valid until re-assigned.
		//#LP ./aliasName %arg: String. The alias name.
		//#LP ./%return: Self (<#ref Context#>), allowing to chain more calls
		//#LP } <-#clearNameAlias#>
		clearNameAlias(alias) {
			delete nameAliases[alias];
			return me;
		},

		//#LP Context/clearCollectionAlias %member %method { <#./%title %noloc: .clearCollectionAlias(collectionAliasName)#>
		// Clear collection alias set by <#ref M/lpgread-interface/Context/collectionAlias#>. The alias is no longer valid until re-assigned.
		//#LP ./collectionAliasName %arg: String. The alias name.
		//#LP ./%return: Self (<#ref Context#>), allowing to chain more calls
		//#LP } <-#clearCollectionAlias#>
		clearCollectionAlias(alias) {
			delete permCollAliases[alias];
			delete tempCollAliases[alias];
			return me;
		},

		//#LP Context/clearQueryAlias %member %method { <#./%title %noloc: .clearQueryAlias(queryAliasName)#>
		// Clear query name alias set by <#ref M/lpgread-interface/Context/queryAlias#>. The alias is no longer valid until re-assigned.
		//#LP ./queryAliasName %arg: String. The alias name.
		//#LP ./%return: Self (<#ref Context#>), allowing to chain more calls
		//#LP } <-#clearQueryAlias#>
		clearQueryAlias(alias) {
			delete queryAliases[alias];
			return me;
		},
		
		//#LP Context/clearConditionAlias %member %method { <#./%title %noloc: .clearConditionAlias(conditionAliasName)#>
		// Clear condition name alias set by <#ref M/lpgread-interface/Context/conditionAlias#>. The alias is no longer valid until re-assigned.
		//#LP ./conditionAliasName %arg: String. The alias name.
		//#LP ./%return: Self (<#ref Context#>), allowing to chain more calls
		//#LP } <-#clearConditionAlias#>
		clearConditionAlias(alias) {
			delete condAliases[alias];
			return me;
		},

		[sCheckCondition](item, condSpec) {
			var cond = compileCondition(reader, condSpec);
			queryCache = new Map(); // clear query cache (this method is not called within a query anyway)
			return cond(me, item);
		},

		// documentation inherited as for item from extents
		currentCollectionAlias(aliasName) {
			if (!currentCollection) throw new Error("No collection is currently a query subject");
			permCollAliases[aliasName] = currentCollection;
			return me;
		},

		[sTempCollectionAlias](aliasName) {
			if (!currentCollection) throw new Error("No collection is currently a query subject");
			tempCollAliases[aliasName] = currentCollection;
		},

		get [sTempCollectionAliases]() { return tempCollAliases; },
		set [sTempCollectionAliases](x) { tempCollAliases = x; },

		get [sCurrentCollection]() { return currentCollection; },
		set [sCurrentCollection](x) { currentCollection = x; },

		get [sQueryCache]() { return queryCache; },

		get [sQueryAliases]() { return queryAliases; },

		get [sCondAliases]() { return condAliases; }
	});
}
//#LP } Context

//#LP lpgread-basic-json/reader { <#./%title %noloc: \<Reader> [lpgread-basic-json]#> <#./%order: 1#>
// Reader object, the primary handle for access to the loaded FDOM.
function BasicJsonFdomReader(rootItemNode, model) {
	if (new.target) return BasicJsonFdomReader(rootItemNode);
	var rootItem,
		me,
		emptySet = new Set(),
		itemsByNode = 
		emptyArray = [];

	function validateName(name) {
		if (typeof (name) == 'string') return;
		if (Array.isArray(name)) {
			for (var nameSeg of name) {
				if (typeof (nameSeg) != 'string') throw new Error("Incorrect name (array-specified) [" + name + "]");
			}
			return;
		}

		throw new Error ("Incorrect name " + name);
	}

	me = {
		//#LP reader/item %member %method { <#./%title %noloc: .item([itemRelTo,] name)#>
		// Get an item by its full or relative FDOM name. Similar to <#ref M/lpgread-interface/Context/item#>, but can not support aliases since it is used outside a context.
		//#LP ./itemRelTo %arg: Optional. If specified, it denotes an item that is considered as base for <#ref reader/name#> path, which is considered a relative path in this case.
		// Can be either of:
		//
		// - string: the full name of base item as string
		// - array: the full name of base item, split into array of short names
		// - <#ref lpgread-basic-json/Item#>: item specified via its direct object
		//#LP ./name %arg: The item name, full if `itemRelTo` is not provided, or relative to it otherwise.
		//#LP ./%return: the item, as <#ref lpgread-basic-json/Item#>. Note that, according to FDOM querying paradigm, it is never a `null` value: if the item is effectively not existing,
		// a null item is returned.
		//#LP } <-#item#>
		item(itemRelTo, name) {
			if (typeof(itemRelTo) == 'string' || Array.isArray(itemRelTo)) {
				name = itemRelTo;
				itemRelTo = rootItem;
			}
			if (typeof (itemRelTo) == 'string') {
				itemRelTo = me.item(itemRelTo);
			}
			if (!(itemRelTo instanceof BasicJsonFdomItem)) {
				throw Error("itemRelTo, if specified, must be an lpgread-basic-json item object or item full name");
			}
			validateName(name);
			var parsedName = Array.isArray(name) ? name : lpUtil.parseName(name),
				node = itemRelTo[sNode];
			for (var nameFrag of parsedName) {
				var node = node.membersById[nameFrag] || (node.membersById[nameFrag] = {
					isNull: true,
					id: nameFrag,
					parent: node,
					tags: emptySet,
					taggedTo: emptySet,
					content: emptyArray,
					members: {},
					membersInOrder: emptySet
				});
			}
			return BasicJsonFdomItem(me, node);
		},

		//#LP reader/itemByUid %member %method { <#./%title %noloc: .itemByUid(uid)#>
		// Return an item by UID (see <#ref lpgread-basic-json/Item/uid#>). Since this is a reader-specific method not prescribed by FDOM comprehension,
		// it can return `null` for non-existent item. Same as <#ref lpgread-basic-json/Context/itemByUid#>.
		//#LP ./uid %arg: String. The item UID, as returned by its `.uid` property.
		//#LP ./%return: <#ref lpgread-basic-json/Item#>, or `null`.
		//#LP } <-#itemByUid#>
		itemByUid(uid) {
			var node;
			return ((node = model.getNodeByUid(uid, true)) && BasicJsonFdomItem(me, node)) || null;
		},
		[sItemsByNode]: new Map(),

		//#LP reader/newQueryContext %member %method { <#./%title %noloc: .newQueryContext()#>
		// Create a new query context object.
		//#LP ./%return: <#ref lpgread-basic-json/Context#>
		//#LP } <-#newQueryContext#>
		newQueryContext() {
			return BasicJsonFdomContext(me);
		},
		__proto__: BasicJsonFdomReader.prototype
	};
	rootItem = me[sRootItem] = BasicJsonFdomItem(me, rootItemNode);

	return me;
}
//#LP } <-#reader#>

//#LP ./loadFromFile %member %method { <#./%title %noloc: async loadFromFile(filePath [, extractSrcFile])#>
// Load the model into memory and expose for reading in FDOM comprehension (<#ref M/model/querying#>). Module level function.
//
// Usage:
// ```
// const { loadFromFile } = require('logipard/lpgread-basic-json.js');
// var reader = await loadFromFile("my-fdom-file.json");
// ```
//#LP ./filePath %arg: String. Path (same as for Node.JS `fs` methods) to the FDOM JSON file.
//#LP ./extractSrcFile %arg: Bool, optional (default is false). If true, then references to LP source file names will be added as inline text fragments.
// Can be useful when reading for or with regard to diagnostic purposes.
//#LP ./%return: The reader handle, <#ref lpgread-basic-json/reader#>
//#LP ./%errors: `loadFromFile` can throw an error.
exports.loadFromFile = async function loadFromFile(filePath, extractSrcFile = false) {
	var model = new BasicJsonFdom();
	await model.loadFromFile(filePath);
	return BasicJsonFdomReader(model.transformForReader(extractSrcFile), model); // model.transformForReader returns the root node
};

//#LP } <-#loadFromFile#>

//#LP } <-#lpgread-basic-json#>