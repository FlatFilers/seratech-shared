import { Flatfile } from "@flatfile/api";
import { states } from "./statesEnum";

export const addresses: Flatfile.SheetConfig = {
  name: "Addresses",
  slug: "addresses",
  fields: [
    {
      key: "customerId",
      type: "reference",
      label: "Customer ID",
      config: {
        ref: "customers",
        key: "id",
        relationship: "has-one",
      },
      metadata: {
        is_dedupe_field: true,
      },
      constraints: [
        {
          type: "required",
        },
      ],
    },
    {
      key: "refDisplayName",
      type: "reference",
      label: "Display Name [Ref]",
      config: {
        ref: "customers",
        key: "displayName",
        relationship: "has-one",
      },
    },
    {
      key: "streetLine1",
      type: "string",
      label: "Street Line 1",
      metadata: {
        is_dedupe_field: true,
      },
    },
    {
      key: "streetLine2",
      type: "string",
      label: "Street Line 2",
      metadata: {
        is_dedupe_field: true,
      },
    },
    {
      key: "city",
      type: "string",
      label: "City",
      metadata: {
        is_dedupe_field: true,
      },
    },
    {
      key: "state",
      type: "enum",
      label: "State",
      config: {
        options: states,
      },
      metadata: {
        is_dedupe_field: true,
      },
    },
    {
      key: "postalCode",
      type: "string",
      label: "Postal Code",
      metadata: {
        is_dedupe_field: true,
      },
    },
    {
      key: "isBilling",
      type: "boolean",
      label: "Billing?",
    },
    {
      key: "notes",
      type: "string",
      label: "Notes",
    },
  ],
  actions: [
    {
      operation: "dedupe",
      mode: "foreground",
      label: "Deduplicate",
      primary: true,
    },
  ],
  constraints: [
    {
      name: "Unique Address",
      fields: ["customerId", "streetLine1"],
      type: "unique",
      strategy: "concat",
    },
  ],
};

export const customers: Flatfile.SheetConfig = {
  name: "Customers",
  slug: "customers",
  fields: [
    {
      key: "id",
      type: "string",
      label: "ID",
      constraints: [
        {
          type: "required",
        },
        {
          type: "unique",
        },
      ],
    },
    {
      key: "firstName",
      type: "string",
      label: "First Name",
    },
    {
      key: "lastName",
      type: "string",
      label: "Last Name",
    },
    {
      key: "displayName",
      type: "string",
      label: "Display Name",
    },
    {
      key: "mobileNumber",
      type: "string",
      label: "Mobile Number",
    },
    {
      key: "homeNumber",
      type: "string",
      label: "Home Number",
    },
    {
      key: "email",
      type: "string",
      label: "Email",
    },
    {
      key: "additionalEmails",
      type: "string",
      label: "Additional Emails",
    },
    {
      key: "company",
      type: "string",
      label: "Company",
    },
    {
      key: "role",
      type: "string",
      label: "Role",
    },
    {
      key: "workNumber",
      type: "string",
      label: "Work Number",
    },
    {
      key: "tags",
      type: "string",
      label: "Tags",
    },
    {
      key: "notes",
      type: "string",
      label: "Notes",
    },
    {
      key: "customerType",
      type: "enum",
      label: "Customer Type",
      config: {
        allowCustom: false,
        options: [
          {
            value: "residential",
            label: "Residential",
          },
          {
            value: "commercial",
            label: "Commercial",
          },
          {
            value: "government",
            label: "Government",
          },
        ],
      },
    },
    {
      key: "customerNotificationsEnabled",
      type: "boolean",
      label: "Customer notifications enabled",
    },
    {
      key: "isContractor",
      type: "boolean",
      label: "Customer is Contractor",
    },
    {
      key: "leadSource",
      type: "string",
      label: "Lead Source",
    },
  ],
  actions: [
    // {
    //   operation: "getAddresses",
    //   mode: "background",
    //   label: "Get Addresses",
    //   primary: true,
    // },
    {
      operation: "dedupe",
      mode: "foreground",
      label: "Deduplicate",
      primary: true,
      inputForm: {
        type: "simple",
        fields: [
          {
            type: "enum",
            config: {
              options: [
                { value: "id", label: "ID" },
                { value: "displayName", label: "Display Name" },
                { value: "mobileNumber", label: "Mobile Number" },
                { value: "homeNumber", label: "Home Number" },
                { value: "workNumber", label: "Work Number" },
                { value: "email", label: "Email" },
                { value: "company", label: "Company" },
              ],
            },
            key: "on",
            label: "Dedupe On",
          },
        ],
      },
    },
    {
      operation: "generateCustIds",
      mode: "background",
      label: "Generate IDs",
      primary: true,
      inputForm: {
        type: "simple",
        fields: [
          {
            type: "string",
            key: "name",
            label: "Name",
            description: "What name would you like to use to generate the IDs?",
          },
        ],
      },
    },
  ],
};

export const invoices: Flatfile.SheetConfig = {
  name: "Invoices",
  slug: "invoices",
  fields: [
    {
      key: "invoice",
      type: "string",
      label: "Invoice",
      constraints: [
        {
          type: "required",
        },
        {
          type: "unique",
        },
      ],
    },
    {
      key: "hcpId",
      type: "string",
      label: "HCP Id",
      constraints: [
        {
          type: "required",
        },
      ],
    },
    {
      key: "createdAt",
      type: "date",
      label: "Created At",
    },
    {
      key: "date",
      type: "date",
      label: "Date",
    },
    {
      key: "endTime",
      type: "string",
      label: "End Time",
    },
    {
      key: "travelDuration",
      type: "number",
      label: "Travel Duration",
    },
    {
      key: "onJobDuration",
      type: "number",
      label: "On Job Duration",
    },
    {
      key: "totalDuration",
      type: "number",
      label: "Total Duration",
    },
    {
      key: "customer",
      type: "string",
      label: "Customer",
    },
    {
      key: "firstName",
      type: "string",
      label: "First Name",
    },
    {
      key: "lastName",
      type: "string",
      label: "Last Name",
    },
    {
      key: "email",
      type: "string",
      label: "Email",
    },
    {
      key: "company",
      type: "string",
      label: "Company",
    },
    {
      key: "mobilePhone",
      type: "string",
      label: "Mobile Phone",
    },
    {
      key: "homePhone",
      type: "string",
      label: "Home Phone",
    },
    {
      key: "customerTags",
      type: "string",
      label: "Customer Tags",
    },
    {
      key: "address",
      type: "string",
      label: "Address",
    },
    {
      key: "street",
      type: "string",
      label: "Street",
    },
    {
      key: "streetLine2",
      type: "string",
      label: "Street Line 2",
    },
    {
      key: "city",
      type: "string",
      label: "City",
    },
    {
      key: "state",
      label: "State",
      type: "enum",
      config: {
        options: states,
      },
    },
    {
      key: "zip",
      type: "string",
      label: "Zip",
    },
    {
      key: "description",
      type: "string",
      label: "Description",
    },
    {
      key: "lineItems",
      type: "string",
      label: "Line Items",
    },
    {
      key: "amount",
      type: "number",
      label: "Amount",
    },
    {
      key: "labor",
      type: "number",
      label: "Labor",
    },
    {
      key: "materials",
      type: "number",
      label: "Materials",
    },
    {
      key: "subtotal",
      type: "number",
      label: "Subtotal",
    },
    {
      key: "paymentHistory",
      type: "string",
      label: "Payment History",
    },
    {
      key: "creditCardFee",
      type: "number",
      label: "Credit Card Fee",
    },
    {
      key: "paidAmount",
      type: "number",
      label: "Paid Amount",
    },
    {
      key: "due",
      type: "number",
      label: "Due",
    },
    {
      key: "discount",
      type: "number",
      label: "Discount",
    },
    {
      key: "tax",
      type: "number",
      label: "Tax",
    },
    {
      key: "taxableAmount",
      type: "number",
      label: "Taxable Amount",
    },
    {
      key: "taxRate",
      type: "number",
      label: "Tax rate",
    },
    {
      key: "jobTags",
      type: "string",
      label: "Job Tags",
    },
    {
      key: "notes",
      type: "string",
      label: "Notes",
    },
    {
      key: "employee",
      type: "string",
      label: "Employee",
    },
    {
      key: "jobStatus",
      type: "string",
      label: "Job Status",
    },
    {
      key: "finished",
      type: "string",
      label: "Finished",
    },
    {
      key: "payment",
      type: "string",
      label: "Payment",
    },
    {
      key: "invoiceSent",
      type: "boolean",
      label: "Invoice Sent",
    },
    {
      key: "window",
      type: "string",
      label: "window",
    },
    {
      key: "attachments",
      type: "string",
      label: "Attachments",
    },
    {
      key: "segments",
      type: "string",
      label: "Segments",
    },
    {
      key: "hcJob",
      type: "string",
      label: "HC Job",
    },
    {
      key: "tipAmount",
      type: "number",
      label: "Tip Amount",
    },
    {
      key: "onlineBookingSource",
      type: "string",
      label: "Online Booking Source",
    },
  ],
  actions: [
    {
      operation: "auto-fix",
      mode: "background",
      label: "Autofix",
      primary: true,
    },
    {
      operation: "mergeRecords",
      mode: "background",
      label: "Merge Records",
      primary: true,
    },
  ],
};
