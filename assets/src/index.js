/**
 * Cloudflare Email — log viewer.
 *
 * A small DataViews app mounted on the Tools → Cloudflare Email screen. All data
 * comes from the cloudflare-email/v1 REST routes; @wordpress/dataviews is bundled
 * (see webpack.config.js), everything else is a core script handle.
 */
import {
	createRoot,
	render,
	useState,
	useEffect,
	useMemo,
	useCallback,
} from '@wordpress/element';
import domReady from '@wordpress/dom-ready';
import apiFetch from '@wordpress/api-fetch';
import { DataViews } from '@wordpress/dataviews';
import {
	Button,
	Spinner,
	Notice,
	Flex,
	FlexItem,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

const config = window.cloudflareEmailLog || { root: '', nonce: '' };

apiFetch.use( apiFetch.createNonceMiddleware( config.nonce ) );

const api = ( path, options = {} ) =>
	apiFetch( { url: `${ config.root }${ path }`, ...options } );

const STATUS_ELEMENTS = [
	{ value: 'sent', label: __( 'Sent', 'cloudflare-email' ) },
	{ value: 'failed', label: __( 'Failed', 'cloudflare-email' ) },
];

function formatDate( value ) {
	if ( ! value ) {
		return '';
	}
	// Stored as site-local 'YYYY-MM-DD HH:MM:SS'.
	const date = new Date( value.replace( ' ', 'T' ) );
	return isNaN( date ) ? value : date.toLocaleString();
}

function StatusBadge( { status } ) {
	const failed = status === 'failed';
	return (
		<span
			style={ {
				display: 'inline-block',
				padding: '2px 8px',
				borderRadius: '2px',
				fontSize: '12px',
				fontWeight: 600,
				color: failed ? '#8a1f11' : '#0a5624',
				background: failed ? '#fbeaea' : '#edf7ed',
			} }
		>
			{ failed
				? __( 'Failed', 'cloudflare-email' )
				: __( 'Sent', 'cloudflare-email' ) }
		</span>
	);
}

function DetailRow( { label, children } ) {
	if ( children === null || children === undefined || children === '' ) {
		return null;
	}
	return (
		<Flex align="flex-start" justify="flex-start" gap={ 4 } style={ { marginBottom: 8 } }>
			<FlexItem style={ { minWidth: 90, fontWeight: 600 } }>{ label }</FlexItem>
			<FlexItem isBlock>{ children }</FlexItem>
		</Flex>
	);
}

function Detail( { log } ) {
	const headers = log.headers || {};
	return (
		<div>
			{ log.status === 'failed' && log.error && (
				<Notice status="error" isDismissible={ false }>
					{ log.error }
				</Notice>
			) }
			<DetailRow label={ __( 'Date', 'cloudflare-email' ) }>
				{ formatDate( log.created_at ) }
			</DetailRow>
			<DetailRow label={ __( 'Status', 'cloudflare-email' ) }>
				<StatusBadge status={ log.status } />
				{ log.resent_count > 0 &&
					' ' +
						sprintf(
							/* translators: %d: number of resends */
							__( '(resent %d×)', 'cloudflare-email' ),
							log.resent_count
						) }
			</DetailRow>
			<DetailRow label={ __( 'From', 'cloudflare-email' ) }>
				{ log.from_email }
			</DetailRow>
			<DetailRow label={ __( 'To', 'cloudflare-email' ) }>
				{ ( log.to || [] ).join( ', ' ) }
			</DetailRow>
			{ !! ( headers.cc || [] ).length && (
				<DetailRow label={ __( 'Cc', 'cloudflare-email' ) }>
					{ headers.cc.join( ', ' ) }
				</DetailRow>
			) }
			{ !! ( headers.bcc || [] ).length && (
				<DetailRow label={ __( 'Bcc', 'cloudflare-email' ) }>
					{ headers.bcc.join( ', ' ) }
				</DetailRow>
			) }
			{ !! headers.reply_to && (
				<DetailRow label={ __( 'Reply-To', 'cloudflare-email' ) }>
					{ headers.reply_to }
				</DetailRow>
			) }
			<DetailRow label={ __( 'Subject', 'cloudflare-email' ) }>
				{ log.subject }
			</DetailRow>
			{ !! ( log.attachments || [] ).length && (
				<DetailRow label={ __( 'Attachments', 'cloudflare-email' ) }>
					{ log.attachments.map( ( a ) => a.name ).join( ', ' ) }
				</DetailRow>
			) }
			<div style={ { marginTop: 12 } }>
				<div style={ { fontWeight: 600, marginBottom: 4 } }>
					{ __( 'Body', 'cloudflare-email' ) }
				</div>
				{ log.body_html ? (
					<iframe
						title={ __( 'Email body', 'cloudflare-email' ) }
						sandbox=""
						srcDoc={ log.body_html }
						style={ {
							width: '100%',
							height: 420,
							border: '1px solid #ddd',
							borderRadius: 2,
							background: '#fff',
						} }
					/>
				) : (
					<pre
						style={ {
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
							background: '#f6f7f7',
							padding: 12,
							borderRadius: 2,
							maxHeight: 420,
							overflow: 'auto',
						} }
					>
						{ log.body_text || '' }
					</pre>
				) }
			</div>
		</div>
	);
}

// Rendered inside the Modal that DataViews provides for a RenderModal action.
function DetailView( { id } ) {
	const [ log, setLog ] = useState( null );
	useEffect( () => {
		let cancelled = false;
		api( `/logs/${ id }` ).then( ( res ) => {
			if ( ! cancelled ) {
				setLog( res );
			}
		} );
		return () => {
			cancelled = true;
		};
	}, [ id ] );

	return log ? <Detail log={ log } /> : <Spinner />;
}

// Rendered inside the Modal that DataViews provides for a RenderModal action.
function DeleteConfirm( { items, closeModal, onDone } ) {
	const [ busy, setBusy ] = useState( false );
	const many = items.length > 1;

	const doDelete = useCallback( async () => {
		setBusy( true );
		try {
			if ( many ) {
				await api( '/logs/bulk-delete', {
					method: 'POST',
					data: { ids: items.map( ( i ) => i.id ) },
				} );
			} else {
				await api( `/logs/${ items[ 0 ].id }`, { method: 'DELETE' } );
			}
			onDone();
			closeModal();
		} finally {
			setBusy( false );
		}
	}, [ items, many, closeModal, onDone ] );

	return (
		<>
			<p>
				{ many
					? sprintf(
							/* translators: %d: number of entries */
							__( 'Delete %d log entries? This cannot be undone.', 'cloudflare-email' ),
							items.length
					  )
					: __( 'Delete this log entry? This cannot be undone.', 'cloudflare-email' ) }
			</p>
			<Flex justify="flex-end" gap={ 3 } style={ { marginTop: 16 } }>
				<Button variant="tertiary" onClick={ closeModal } disabled={ busy }>
					{ __( 'Cancel', 'cloudflare-email' ) }
				</Button>
				<Button variant="primary" isDestructive onClick={ doDelete } isBusy={ busy }>
					{ __( 'Delete', 'cloudflare-email' ) }
				</Button>
			</Flex>
		</>
	);
}

const DEFAULT_VIEW = {
	type: 'table',
	page: 1,
	perPage: 20,
	search: '',
	filters: [],
	sort: { field: 'created_at', direction: 'desc' },
	fields: [ 'created_at', 'status', 'from_email', 'to' ],
	titleField: 'subject',
};

function App() {
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ data, setData ] = useState( [] );
	const [ paginationInfo, setPaginationInfo ] = useState( {
		totalItems: 0,
		totalPages: 0,
	} );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const [ notice, setNotice ] = useState( null );

	const refresh = useCallback( () => setRefreshKey( ( k ) => k + 1 ), [] );

	useEffect( () => {
		let cancelled = false;
		setIsLoading( true );

		const statusFilter = ( view.filters || [] ).find(
			( f ) => f.field === 'status'
		);
		const params = new URLSearchParams( {
			page: String( view.page ),
			per_page: String( view.perPage ),
		} );
		if ( view.search ) {
			params.set( 'search', view.search );
		}
		if ( statusFilter && statusFilter.value ) {
			const v = Array.isArray( statusFilter.value )
				? statusFilter.value[ 0 ]
				: statusFilter.value;
			if ( v ) {
				params.set( 'status', v );
			}
		}
		if ( view.sort && view.sort.field ) {
			params.set( 'orderby', view.sort.field );
			params.set( 'order', view.sort.direction || 'desc' );
		}

		api( `/logs?${ params.toString() }` )
			.then( ( res ) => {
				if ( cancelled ) {
					return;
				}
				setData( res.logs || [] );
				setPaginationInfo( {
					totalItems: res.total || 0,
					totalPages: res.totalPages || 0,
				} );
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setNotice(
						err.message ||
							__( 'Failed to load the email log.', 'cloudflare-email' )
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setIsLoading( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ view, refreshKey ] );

	const fields = useMemo(
		() => [
			{
				id: 'created_at',
				label: __( 'Date', 'cloudflare-email' ),
				enableSorting: true,
				enableHiding: false,
				render: ( { item } ) => formatDate( item.created_at ),
			},
			{
				id: 'status',
				label: __( 'Status', 'cloudflare-email' ),
				enableSorting: true,
				elements: STATUS_ELEMENTS,
				filterBy: { operators: [ 'is' ] },
				render: ( { item } ) => <StatusBadge status={ item.status } />,
			},
			{
				id: 'from_email',
				label: __( 'From', 'cloudflare-email' ),
				enableSorting: true,
			},
			{
				id: 'to',
				label: __( 'To', 'cloudflare-email' ),
				enableSorting: false,
				render: ( { item } ) => ( item.to || [] ).join( ', ' ),
			},
			{
				id: 'subject',
				label: __( 'Subject', 'cloudflare-email' ),
				enableSorting: true,
			},
		],
		[]
	);

	const actions = useMemo(
		() => [
			{
				id: 'view',
				label: __( 'View', 'cloudflare-email' ),
				isPrimary: true,
				modalHeader: __( 'Email details', 'cloudflare-email' ),
				RenderModal: ( { items } ) => (
					<DetailView id={ items[ 0 ].id } />
				),
			},
			{
				id: 'resend',
				label: __( 'Resend', 'cloudflare-email' ),
				callback: async ( items ) => {
					try {
						await api( `/logs/${ items[ 0 ].id }/resend`, {
							method: 'POST',
						} );
						setNotice(
							__( 'Email resent.', 'cloudflare-email' )
						);
					} catch ( err ) {
						setNotice(
							err.message ||
								__( 'Resend failed.', 'cloudflare-email' )
						);
					}
					refresh();
				},
			},
			{
				id: 'delete',
				label: __( 'Delete', 'cloudflare-email' ),
				isDestructive: true,
				supportsBulk: true,
				modalHeader: __( 'Delete log entries', 'cloudflare-email' ),
				RenderModal: ( { items, closeModal } ) => (
					<DeleteConfirm
						items={ items }
						closeModal={ closeModal }
						onDone={ refresh }
					/>
				),
			},
		],
		[ refresh ]
	);

	return (
		<>
			<h1 className="wp-heading-inline" style={ { marginBottom: 16 } }>
				{ __( 'Cloudflare Email log', 'cloudflare-email' ) }
			</h1>
			{ notice && (
				<Notice status="info" onRemove={ () => setNotice( null ) }>
					{ notice }
				</Notice>
			) }
			<DataViews
				data={ data }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				actions={ actions }
				paginationInfo={ paginationInfo }
				isLoading={ isLoading }
				defaultLayouts={ { table: {} } }
				getItemId={ ( item ) => String( item.id ) }
			/>
		</>
	);
}

domReady( () => {
	const el = document.getElementById( 'cloudflare-email-log-root' );
	if ( ! el ) {
		return;
	}
	if ( typeof createRoot === 'function' ) {
		createRoot( el ).render( <App /> );
	} else {
		render( <App />, el );
	}
} );
