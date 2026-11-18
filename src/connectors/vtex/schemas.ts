import { z } from 'zod'

/**
 * Validação das respostas da VTEX na borda. Só os campos que o ETL grava; o resto é descartado (z.object remove chave
 * desconhecida). Campo que a VTEX pode omitir ou mandar nulo é `nullish`: a falta dele não derruba a carga, e a
 * transformação decide o que gravar.
 *
 * Referência: specs OpenAPI públicas da VTEX (github.com/vtex/openapi-schemas, "Orders API" e "Catalog API"). Campos
 * que o dicionário da WPP tem e a spec não lista (hostname, lastChange, isAllDelivered, isAnyDelivered e
 * readyForHandlingDate na lista de pedidos) ficam opcionais.
 */

const nullableText = z.string().nullish()
const nullableNumber = z.number().nullish()
const nullableBoolean = z.boolean().nullish()
/** IDs que a VTEX manda ora como número, ora como texto ("18"). */
const numberOrText = z.union([z.number(), z.string()])

// --- OMS: lista de pedidos (GET /api/oms/pvt/orders) ---

const listOrderSchema = z.object({
	orderId: z.string().min(1),
	creationDate: z.string(),
	totalValue: z.number(),
	status: nullableText,
	statusDescription: nullableText,
	marketPlaceOrderId: nullableText,
	sequence: nullableText,
	salesChannel: nullableText,
	affiliateId: nullableText,
	origin: nullableText,
	workflowInErrorState: nullableBoolean,
	workflowInRetry: nullableBoolean,
	ShippingEstimatedDate: nullableText,
	ShippingEstimatedDateMax: nullableText,
	ShippingEstimatedDateMin: nullableText,
	orderIsComplete: nullableBoolean,
	authorizedDate: nullableText,
	totalItems: nullableNumber,
	currencyCode: nullableText,
	hostname: nullableText,
	lastChange: nullableText,
	isAllDelivered: nullableBoolean,
	isAnyDelivered: nullableBoolean,
	readyForHandlingDate: nullableText
})

const pagingSchema = z.object({
	total: z.number().int().min(0),
	pages: z.number().int().min(0),
	currentPage: z.number().int().min(0),
	perPage: z.number().int().min(0)
})

const listOrdersPageSchema = z.object({
	list: z.array(listOrderSchema),
	paging: pagingSchema
})

// --- OMS: detalhe do pedido (GET /api/oms/pvt/orders/{orderId}) ---

const totalSchema = z.object({ id: z.string(), value: z.number() })

const itemSchema = z.object({
	uniqueId: z.string().min(1),
	id: numberOrText,
	productId: numberOrText,
	ean: nullableText,
	lockId: nullableText,
	quantity: z.number(),
	seller: numberOrText,
	name: z.string(),
	refId: nullableText,
	price: z.number(),
	listPrice: z.number(),
	manualPrice: nullableNumber,
	imageUrl: nullableText,
	detailUrl: nullableText,
	sellerSku: nullableText,
	commission: nullableNumber,
	tax: nullableNumber,
	preSaleDate: nullableText,
	additionalInfo: z.unknown(),
	measurementUnit: nullableText,
	unitMultiplier: nullableNumber,
	sellingPrice: nullableNumber,
	isGift: nullableBoolean,
	shippingPrice: nullableNumber,
	rewardValue: nullableNumber,
	freightCommission: nullableNumber,
	taxCode: nullableText,
	costPrice: nullableNumber
})

const deliveryIdSchema = z.object({
	courierId: nullableText,
	courierName: nullableText,
	dockId: nullableText,
	quantity: nullableNumber,
	warehouseId: nullableText,
	accountCarrierName: nullableText
})

const logisticsInfoSchema = z.object({
	itemIndex: z.number().int(),
	itemId: numberOrText.nullish(),
	selectedSla: nullableText,
	lockTTL: nullableText,
	price: nullableNumber,
	listPrice: nullableNumber,
	sellingPrice: nullableNumber,
	deliveryWindow: z.unknown(),
	deliveryCompany: nullableText,
	deliveryChannel: nullableText,
	addressId: nullableText,
	deliveryIds: z.array(deliveryIdSchema).nullish()
})

const addressSchema = z.object({
	addressId: z.string(),
	addressType: nullableText,
	neighborhood: nullableText,
	postalCode: nullableText,
	city: nullableText,
	state: nullableText,
	country: nullableText
})

const paymentSchema = z.object({
	id: z.string(),
	paymentSystem: numberOrText,
	paymentSystemName: z.string(),
	value: nullableNumber,
	installments: nullableNumber,
	referenceValue: nullableNumber,
	redemptionCode: nullableText,
	giftCardId: nullableText,
	giftCardName: nullableText,
	giftCardCaption: nullableText,
	giftCardAsDiscount: nullableBoolean,
	giftCardProvider: nullableText,
	group: nullableText,
	tid: nullableText
})

const transactionSchema = z.object({
	isActive: nullableBoolean,
	transactionId: nullableText,
	merchantName: nullableText,
	payments: z.array(paymentSchema).nullish()
})

const giftCardSchema = z.object({
	id: numberOrText,
	redemptionCode: nullableText,
	name: nullableText,
	caption: nullableText,
	value: nullableNumber,
	balance: nullableNumber,
	provider: nullableText,
	groupName: nullableText,
	inUse: nullableBoolean,
	isSpecialCard: nullableBoolean
})

const rateIdentifierSchema = z.object({
	id: z.string(),
	name: z.string(),
	featured: z.boolean()
})

const clientProfileSchema = z.object({
	email: nullableText,
	firstName: nullableText,
	lastName: nullableText,
	documentType: nullableText,
	document: nullableText,
	phone: nullableText,
	isCorporate: nullableBoolean,
	userProfileId: nullableText
})

const orderDetailSchema = z.object({
	orderId: z.string().min(1),
	sequence: z.string(),
	marketplaceOrderId: nullableText,
	marketplaceServicesEndpoint: nullableText,
	sellerOrderId: nullableText,
	origin: z.string(),
	affiliateId: nullableText,
	salesChannel: z.string(),
	merchantName: nullableText,
	status: z.string(),
	statusDescription: nullableText,
	value: z.number(),
	creationDate: z.string(),
	lastChange: z.string(),
	orderGroup: nullableText,
	totals: z.array(totalSchema).nullish(),
	followUpEmail: nullableText,
	hostname: z.string(),
	openTextField: z.unknown(),
	roundingError: nullableNumber,
	orderFormId: nullableText,
	commercialConditionData: z.unknown(),
	isCompleted: z.boolean(),
	allowCancellation: z.boolean(),
	allowEdition: z.boolean(),
	isCheckedIn: z.boolean(),
	authorizedDate: nullableText,
	invoicedDate: nullableText,
	items: z.array(itemSchema).nullish(),
	sellers: z.array(z.object({ id: numberOrText, name: nullableText })).nullish(),
	clientProfileData: clientProfileSchema.nullish(),
	marketingData: z.object({ utmSource: nullableText, coupon: nullableText }).nullish(),
	ratesAndBenefitsData: z.object({ rateAndBenefitsIdentifiers: z.array(rateIdentifierSchema).nullish() }).nullish(),
	shippingData: z
		.object({
			address: addressSchema.nullish(),
			logisticsInfo: z.array(logisticsInfoSchema).nullish()
		})
		.nullish(),
	paymentData: z
		.object({
			transactions: z.array(transactionSchema).nullish(),
			giftCards: z.array(giftCardSchema).nullish()
		})
		.nullish()
})

// --- Catálogo ---

/** GET /api/catalog_system/pvt/products/GetProductAndSkuIds: data = { "<productId>": [skuIds] }. */
const productAndSkuIdsSchema = z.object({
	data: z.record(z.string(), z.array(z.number()).nullable()),
	range: z.object({ total: z.number().int().min(0), from: z.number().int(), to: z.number().int() })
})

/** GET /api/catalog/pvt/product/{productId} */
const productSchema = z.object({
	Id: z.number().int(),
	Name: z.string(),
	DepartmentId: z.number().int(),
	CategoryId: z.number().int(),
	BrandId: z.number().int(),
	LinkId: z.string(),
	RefId: nullableText,
	IsVisible: z.boolean(),
	Description: nullableText,
	DescriptionShort: nullableText,
	ReleaseDate: nullableText,
	KeyWords: nullableText,
	Title: nullableText,
	IsActive: z.boolean(),
	TaxCode: nullableText,
	MetaTagDescription: nullableText,
	SupplierId: z.union([z.number(), z.string()]).nullish(),
	ShowWithoutStock: z.union([z.boolean(), z.string()]).nullish(),
	AdWordsRemarketingCode: nullableText,
	LomadeeCampaignCode: nullableText,
	Score: z.union([z.number(), z.string()]).nullish()
})

interface iCategoryNode {
	id: number
	name: string
	hasChildren: boolean
	url: string
	Title?: string | null
	MetaTagDescription?: string | null
	children: iCategoryNode[]
}

/** GET /api/catalog_system/pub/category/tree/{levels} — árvore recursiva. */
const categoryNodeSchema: z.ZodType<iCategoryNode> = z.lazy(() =>
	z.object({
		id: z.number().int(),
		name: z.string(),
		hasChildren: z.boolean(),
		url: z.string(),
		Title: nullableText,
		MetaTagDescription: nullableText,
		children: z.array(categoryNodeSchema).default([])
	})
)

const categoryTreeSchema = z.array(categoryNodeSchema)

type tListOrder = z.infer<typeof listOrderSchema>
type tListOrdersPage = z.infer<typeof listOrdersPageSchema>
type tOrderDetail = z.infer<typeof orderDetailSchema>
type tProductAndSkuIds = z.infer<typeof productAndSkuIdsSchema>
type tProduct = z.infer<typeof productSchema>

export { categoryTreeSchema, listOrdersPageSchema, orderDetailSchema, productAndSkuIdsSchema, productSchema }
export type { iCategoryNode, tListOrder, tListOrdersPage, tOrderDetail, tProduct, tProductAndSkuIds }
